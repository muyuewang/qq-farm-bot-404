/**
 * 图鉴服务 - 获取和管理作物图鉴
 *
 * 功能：
 * - 获取图鉴列表（支持原始 protobuf 解码回退）
 * - 领取图鉴奖励
 * - 图鉴数据汇总与分类
 */
const { types } = require('../utils/proto');
const { sendMsgAsync } = require('../utils/network');
const { toNum } = require('../utils/utils');
const { createModuleLogger } = require('./logger');

const logger = createModuleLogger('illustrated');

// ---- Protobuf 原始解码工具 ----

/**
 * 读取 varint
 */
function readVarint(buffer, offset) {
  let value = 0n;
  let shift = 0n;
  let pos = offset;
  while (pos < buffer.length) {
    const byte = BigInt(buffer[pos]);
    value |= (byte & 0x7Fn) << shift;
    pos += 1;
    if ((byte & 0x80n) === 0n) break;
    shift += 7n;
  }
  return { value, next: pos };
}

/**
 * 扫描 Protobuf 消息字段
 */
function scanProtobufMessage(buf) {
  const fields = [];
  let pos = 0;
  while (pos < buf.length) {
    const tag = readVarint(buf, pos);
    if (tag.next <= pos) break;
    pos = tag.next;
    const fieldNum = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 0x7n);

    if (wireType === 0) {
      // Varint
      const v = readVarint(buf, pos);
      fields.push({ field: fieldNum, wire: wireType, value: Number(v.value) });
      pos = v.next;
    } else if (wireType === 2) {
      // Length-delimited
      const lenTag = readVarint(buf, pos);
      const length = Number(lenTag.value);
      const dataStart = lenTag.next;
      const dataEnd = dataStart + length;
      fields.push({ field: fieldNum, wire: wireType, length, bytes: buf.subarray(dataStart, dataEnd) });
      pos = dataEnd;
    } else if (wireType === 5) {
      // 32-bit fixed
      fields.push({ field: fieldNum, wire: wireType, bytes: buf.subarray(pos, pos + 4) });
      pos += 4;
    } else if (wireType === 1) {
      // 64-bit fixed
      fields.push({ field: fieldNum, wire: wireType, bytes: buf.subarray(pos, pos + 8) });
      pos += 8;
    } else {
      break;
    }
  }
  return fields;
}

/**
 * 从原始 protobuf 字节解码图鉴回复
 * 用于当 proto 解码失败时的回退方案
 */
function decodeIllustratedReplyRaw(rawBody) {
  const fields = scanProtobufMessage(Buffer.from(rawBody));
  const topLevelVarint = (field) => {
    const match = fields.find(item => item.field === field && item.wire === 0);
    return match ? Number(match.value) : 0;
  };

  // 提取 field=1, wire=2 的子消息（图鉴条目列表）
  const rawItems = fields
    .filter((f) => f.field === 1 && f.wire === 2 && f.bytes)
    .map((f, idx) => {
      const subFields = scanProtobufMessage(f.bytes);
      const summary = {};
      for (const sf of subFields) {
        const arr = summary[sf.field] || [];
        arr.push(sf.wire === 0 ? sf.value : `wire${sf.wire}:${sf.length ?? sf.bytes?.length ?? 0}`);
        summary[sf.field] = arr;
      }
      return { index: idx, byteLength: f.length, fieldSummary: summary, rawBytes: f.bytes, rawHex: Buffer.from(f.bytes).toString('hex') };
    });

  // 标准化 item
  const normalized = rawItems
    .map((item) => {
      const getFieldValue = (fieldNum) => {
        const sub = scanProtobufMessage(Buffer.from(item.rawBytes));
        const found = sub.find((f) => f.field === fieldNum && f.wire === 0);
        return found ? Number(found.value) : 0;
      };
      const getFieldBytes = (fieldNum) => {
        const sub = scanProtobufMessage(Buffer.from(item.rawBytes));
        const found = sub.find((f) => f.field === fieldNum && f.wire === 2);
        return found?.bytes ? Buffer.from(found.bytes) : null;
      };

      const fruitId = getFieldValue(1);
      const illustratedTier = getFieldValue(2);
      const unlockFlag = getFieldValue(3);
      const rewardScore = getFieldValue(4);
      const extraValue = getFieldValue(5);
      const rewardInfoBytes = getFieldBytes(6);
      const hasReward = getFieldValue(7);
      const guaranteeInfoBytes = getFieldBytes(8);
      const guaranteeInfoFields = guaranteeInfoBytes
        ? scanProtobufMessage(guaranteeInfoBytes)
        : [];
      const getGuaranteeValue = (fieldNum) => {
        const found = guaranteeInfoFields.find((f) => f.field === fieldNum && f.wire === 0);
        return found ? Number(found.value) : 0;
      };
      const guaranteeInfo = guaranteeInfoBytes
        ? {
            progress_type: getGuaranteeValue(1),
            current: getGuaranteeValue(2),
            total: getGuaranteeValue(3),
          }
        : null;

      return {
        fruitId,
        illustratedTier,
        unlockFlag,
        unlocked: unlockFlag > 0,
        planted: unlockFlag > 0,
        rewardScore,
        extraValue,
        rewardInfoBase64: rewardInfoBytes ? rewardInfoBytes.toString('base64') : '',
        hasReward: hasReward > 0,
        guaranteeInfo,
      };
    })
    .filter((item) => item.fruitId > 0);

  return {
    rawItemCount: rawItems.length,
    rawItems,
    normalizedItems: normalized,
    currentScore: topLevelVarint(2),
    level: topLevelVarint(3),
    currentTier: topLevelVarint(6),
    nextScore: topLevelVarint(7),
    hasLevelReward: topLevelVarint(9) === 1,
  };
}

// ---- RPC 调用 ----

/**
 * 获取图鉴列表
 * @param {boolean} refresh - 是否强制刷新
 * @param {number} illustratedType - 图鉴类型，默认 1
 */
async function getIllustratedListV2(refresh = false, illustratedType = 1) {
  const request = types.GetIllustratedListV2Request.encode(
    types.GetIllustratedListV2Request.create({
      refresh: !!refresh,
      illustrated_type: Number(illustratedType) || 1,
    })
  ).finish();

  try {
    const { body } = await sendMsgAsync(
      'gamepb.illustratedpb.IllustratedService',
      'GetIllustratedListV2',
      request
    );

    logger.info('图鉴API响应', {
      replyBodyLength: body ? body.length : 0,
      replyBodyType: typeof body,
    });

    // 尝试用 proto 解码
    let decoded;
    try {
      decoded = types.GetIllustratedListV2Reply.decode(body);
      logger.info('图鉴解码成功', { itemsCount: decoded.items ? decoded.items.length : 0 });
    } catch (err) {
      logger.error('图鉴解码失败', { error: err.message });
      decoded = { items: [] };
    }

    // 原始解析作为回退和辅助
    const raw = decodeIllustratedReplyRaw(body);
    logger.info('图鉴原始数据解析', { rawItemCount: raw.rawItemCount, normalizedCount: raw.normalizedItems.length });
    const summary = {
      current_score: raw.currentScore,
      level: raw.level,
      current_tier: raw.currentTier,
      next_score: raw.nextScore,
      has_level_reward: raw.hasLevelReward,
    };

    // 优先使用 proto 解码的结果
    if (decoded.items && decoded.items.length > 0) {
      return { ...decoded, ...summary, __raw: raw };
    }

    // 回退：用原始解析构建 items
    if (raw.normalizedItems.length > 0) {
      const items = raw.normalizedItems.map((item) => ({
        seed_id: item.fruitId,
        unlocked: item.unlocked,
        planted: item.planted,
        planted_count: 0,
        harvest_count: 0,
        category: 1,
        has_reward: item.hasReward,
        guarantee_info: item.guaranteeInfo,
      }));
      return { items, ...summary, __raw: raw };
    }

    return { items: [], ...summary, __raw: raw };
  } catch (err) {
    logger.error('获取图鉴列表失败', { error: err.message, stack: err.stack });
    return {
      items: [],
      __raw: { rawItemCount: 0, rawItems: [], normalizedItems: [] },
    };
  }
}

/**
 * 领取所有图鉴奖励
 */
async function claimAllRewardsV2(onlyClaimable = true) {
  const request = types.ClaimAllRewardsV2Request.encode(
    types.ClaimAllRewardsV2Request.create({ only_claimable: !!onlyClaimable })
  ).finish();
  const { body } = await sendMsgAsync(
    'gamepb.illustratedpb.IllustratedService',
    'ClaimAllRewardsV2',
    request
  );
  return types.ClaimAllRewardsV2Reply.decode(body);
}

// ---- 数据汇总 ----

/**
 * 汇总图鉴条目统计
 */
function summarizeIllustratedItems(items = []) {
  const list = Array.isArray(items) ? items : [];
  return {
    total: list.length,
    unlocked: list.filter((i) => !!i.unlocked).length,
    planted: list.filter((i) => !!i.planted).length,
    claimable: list.filter((i) => !!i.has_reward).length,
  };
}

/**
 * 图鉴类型分类
 * 1=作物(crop), 2=鲜花(flower), 3=树木(tree)
 */
function normalizeIllustratedCategory(value) {
  const type = toNum(value);
  if (type === 1) return 'crop';
  if (type === 2) return 'flower';
  if (type === 3) return 'tree';
  return 'unknown';
}

module.exports = {
  getIllustratedListV2,
  claimAllRewardsV2,
  summarizeIllustratedItems,
  normalizeIllustratedCategory,
  decodeIllustratedReplyRaw,
};
