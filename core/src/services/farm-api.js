const { sendMsgAsync, getUserState } = require('../utils/network');
const { types, waitForProtoReady } = require('../utils/proto');
const { toLong, sleep, log } = require('../utils/utils');
const { getLandForecastRevision, rememberLandForecast } = require('./level-forecast');

/** 普通化肥 ID */
const NORMAL_FERTILIZER_ID = 1011;
/** 有机化肥 ID */
const ORGANIC_FERTILIZER_ID = 1012;

// ─── 操作次数限制回调 ───

let onOperationLimitsUpdate = null;
function setOperationLimitsCallback(callback) {
  onOperationLimitsUpdate = callback;
}

// ─── 内部辅助 ───

/** 发送种植相关请求（通用） */
async function sendPlantRequest(ReqType, ReplyType, method, landIds, hostGid) {
  const payload = ReqType.encode(ReqType.create({
    land_ids: landIds,
    host_gid: toLong(hostGid)
  })).finish();
  const { body } = await sendMsgAsync('gamepb.plantpb.PlantService', method, payload);
  return ReplyType.decode(body);
}

// ─── 农场 API ───

/** 获取所有地块数据 */
async function getAllLands() {
  const revision = getLandForecastRevision();
  const payload = types.AllLandsRequest.encode(types.AllLandsRequest.create({})).finish();
  const { body } = await sendMsgAsync('gamepb.plantpb.PlantService', 'AllLands', payload);
  const reply = types.AllLandsReply.decode(body);
  rememberLandForecast(reply.lands, getUserState(), revision);
  if (reply.operation_limits && onOperationLimitsUpdate) {
    onOperationLimitsUpdate(reply.operation_limits);
  }
  return reply;
}

/** 一键收获 */
async function harvest(landIds) {
  const userState = getUserState();
  const payload = types.HarvestRequest.encode(types.HarvestRequest.create({
    land_ids: landIds,
    host_gid: toLong(userState.gid),
    is_all: true
  })).finish();
  const { body } = await sendMsgAsync('gamepb.plantpb.PlantService', 'Harvest', payload);
  return types.HarvestReply.decode(body);
}

/** 浇水 */
async function waterLand(landIds) {
  const userState = getUserState();
  return sendPlantRequest(types.WaterLandRequest, types.WaterLandReply, 'WaterLand', landIds, userState.gid);
}

/** 一键务农（浇水/除草/除虫） */
async function farming(landIds) {
  const userState = getUserState();
  return sendPlantRequest(types.FarmingRequest, types.FarmingReply, 'Farming', landIds, userState.gid);
}

/** 除草 */
async function weedOut(landIds) {
  const userState = getUserState();
  return sendPlantRequest(types.WeedOutRequest, types.WeedOutReply, 'WeedOut', landIds, userState.gid);
}

/** 除虫 */
async function insecticide(landIds) {
  const userState = getUserState();
  return sendPlantRequest(types.InsecticideRequest, types.InsecticideReply, 'Insecticide', landIds, userState.gid);
}

/**
 * 施肥
 * @param {number[]} landIds - 地块 ID 列表
 * @param {number} fertilizerId - 化肥类型（默认普通化肥）
 * @returns {number} 成功施肥次数
 */
async function fertilize(landIds, fertilizerId = NORMAL_FERTILIZER_ID) {
  let successCount = 0;
  for (const landId of landIds) {
    try {
      const payload = types.FertilizeRequest.encode(types.FertilizeRequest.create({
        land_ids: [toLong(landId)],
        fertilizer_id: toLong(fertilizerId)
      })).finish();
      await sendMsgAsync('gamepb.plantpb.PlantService', 'Fertilize', payload);
      successCount++;
    } catch {
      break;
    }
    // 多地施肥时加入间隔避免请求过快
    if (landIds.length > 1) {
      await sleep(200, 600);
    }
  }
  return successCount;
}

/** 铲除植物 */
async function removePlant(landIds) {
  const payload = types.RemovePlantRequest.encode(types.RemovePlantRequest.create({
    land_ids: landIds.map(id => toLong(id))
  })).finish();
  const { body } = await sendMsgAsync('gamepb.plantpb.PlantService', 'RemovePlant', payload);
  return types.RemovePlantReply.decode(body);
}

/** 升级土地 */
async function upgradeLand(landId) {
  const payload = types.UpgradeLandRequest.encode(types.UpgradeLandRequest.create({
    land_id: toLong(landId)
  })).finish();
  const { body } = await sendMsgAsync('gamepb.plantpb.PlantService', 'UpgradeLand', payload);
  return types.UpgradeLandReply.decode(body);
}

/**
 * 解锁土地
 * @param {number} landId - 土地 ID
 * @param {boolean} doShared - 是否使用共享解锁
 */
async function unlockLand(landId, doShared = false) {
  const payload = types.UnlockLandRequest.encode(types.UnlockLandRequest.create({
    land_id: toLong(landId),
    do_shared: !!doShared
  })).finish();
  const { body } = await sendMsgAsync('gamepb.plantpb.PlantService', 'UnlockLand', payload);
  return types.UnlockLandReply.decode(body);
}

/** 获取商店列表 */
async function getShopProfiles() {
  await waitForProtoReady();
  const payload = types.ShopProfilesRequest.encode(types.ShopProfilesRequest.create({})).finish();
  const { body } = await sendMsgAsync('gamepb.shoppb.ShopService', 'ShopProfiles', payload);
  return types.ShopProfilesReply.decode(body);
}

/** 种子商店 ID：协议与管理面板都已固定为 2 */
const cachedSeedShopId = 2;
async function getSeedShopId() {
  return cachedSeedShopId;
}

/** 获取商店商品信息 */
async function getShopInfo(shopId) {
  await waitForProtoReady();
  const payload = types.ShopInfoRequest.encode(types.ShopInfoRequest.create({
    shop_id: toLong(shopId)
  })).finish();
  const { body } = await sendMsgAsync('gamepb.shoppb.ShopService', 'ShopInfo', payload);
  return types.ShopInfoReply.decode(body);
}

/**
 * 购买商品
 * @param {number} goodsId - 商品 ID
 * @param {number} num - 购买数量
 * @param {number} price - 单价
 */
async function buyGoods(goodsId, num, price) {
  await waitForProtoReady();
  const payload = types.BuyGoodsRequest.encode(types.BuyGoodsRequest.create({
    goods_id: toLong(goodsId),
    num: toLong(num),
    price: toLong(price)
  })).finish();
  const { body } = await sendMsgAsync('gamepb.shoppb.ShopService', 'BuyGoods', payload);
  return types.BuyGoodsReply.decode(body);
}

module.exports = {
  NORMAL_FERTILIZER_ID,
  ORGANIC_FERTILIZER_ID,
  setOperationLimitsCallback,
  getAllLands,
  harvest,
  waterLand,
  farming,
  weedOut,
  insecticide,
  fertilize,
  removePlant,
  upgradeLand,
  unlockLand,
  getShopInfo,
  buyGoods,
  getShopProfiles,
  getSeedShopId
};
