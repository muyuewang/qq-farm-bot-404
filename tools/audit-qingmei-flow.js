/*
 * Print a compact chronological audit of the QingMei capture flow.
 * Usage: pnpm -C core exec node ../tools/audit-qingmei-flow.js <capture-dir> [filename-prefix]
 */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const coreRequire = createRequire(path.resolve(__dirname, '../core/package.json'));
const protobuf = coreRequire('protobufjs');
const cryptoWasm = require('../core/dist/utils/crypto-wasm');

const captureDir = path.resolve(process.argv[2] || 'C:/Users/liyp/Downloads/协议');
const filenamePrefix = String(process.argv[3] || 'ws_202608121522');
const protoDir = path.resolve(__dirname, '../core/src/proto');

function number(value) {
    if (value && typeof value === 'object' && typeof value.toNumber === 'function') return value.toNumber();
    return Number(value || 0);
}

function rawFields(buffer) {
    const reader = protobuf.Reader.create(buffer);
    const fields = [];
    while (reader.pos < reader.len) {
        const tag = reader.uint32();
        const field = tag >>> 3;
        const wire = tag & 7;
        if (wire === 0) fields.push({ field, value: reader.uint64().toString() });
        else if (wire === 1) fields.push({ field, value: reader.fixed64().toString() });
        else if (wire === 2) fields.push({ field, hex: Buffer.from(reader.bytes()).toString('hex') });
        else if (wire === 5) fields.push({ field, value: String(reader.fixed32()) });
        else throw new Error(`unsupported wire ${wire}`);
    }
    return fields;
}

async function main() {
    const root = new protobuf.Root();
    await root.load(fs.readdirSync(protoDir).filter(name => name.endsWith('.proto')).map(name => path.join(protoDir, name)), { keepCase: true });
    const gate = root.lookupType('gatepb.Message');
    const activityReply = root.lookupType('gamepb.activitypb.ActivityOperateReply');
    const shareTypes = {
        'CheckCanShare:SEND': root.lookupType('gamepb.sharepb.CheckCanShareRequest'),
        'CheckCanShare:RECV': root.lookupType('gamepb.sharepb.CheckCanShareReply'),
        'ReportShare:SEND': root.lookupType('gamepb.sharepb.ReportShareRequest'),
        'ReportShare:RECV': root.lookupType('gamepb.sharepb.ReportShareReply'),
    };
    const names = fs.readdirSync(captureDir)
        .filter(name => name.endsWith('.bin') && name.startsWith(filenamePrefix))
        .sort();

    for (const name of names) {
        let message;
        try { message = gate.decode(fs.readFileSync(path.join(captureDir, name))); } catch { continue; }
        const meta = message.meta || {};
        const direction = number(meta.message_type) === 1 ? 'SEND' : number(meta.message_type) === 2 ? 'RECV' : 'NOTIFY';
        const service = String(meta.service_name || '');
        const method = String(meta.method_name || '');
        let body = Buffer.from(message.body || []);
        if (direction === 'SEND' && body.length) body = await cryptoWasm.decryptBuffer(body);

        const row = {
            file: name,
            direction,
            seq: number(meta.client_seq),
            service,
            method,
            errorCode: number(meta.error_code),
            errorMessage: String(meta.error_message || ''),
        };
        if (service === 'gamepb.activitypb.ActivityService' && method === 'Operate') {
            if (direction === 'RECV' && !row.errorCode) {
                const decoded = activityReply.toObject(activityReply.decode(body), { longs: String, bytes: String });
                const brew = decoded.data?.qingmei_brew;
                row.activity = decoded.activity_id;
                row.operation = decoded.operate_type;
                row.brew = brew ? {
                    round: brew.current_round || '0',
                    maxRounds: brew.max_rounds || '0',
                    prices: brew.quote_prices || [],
                    totals: brew.quote_totals || [],
                    finished: !!brew.finished,
                } : null;
                row.quote = decoded.data?.qingmei_quote || null;
                row.replyExtraFields = rawFields(body).filter(field => ![1, 2, 3, 104].includes(field.field));
            } else if (direction === 'SEND') {
                const fields = rawFields(body);
                row.activity = fields.find(field => field.field === 1)?.value || '0';
                row.operation = fields.find(field => field.field === 2)?.value || '0';
                row.params = fields.filter(field => field.field > 2);
                row.bodyHex = body.toString('hex');
            }
        } else if (service === 'gamepb.sharepb.ShareService') {
            const type = shareTypes[`${method}:${direction}`];
            row.bodyHex = body.toString('hex');
            row.share = type
                ? type.toObject(type.decode(body), { longs: String, bytes: String })
                : rawFields(body);
        }
        console.log(JSON.stringify(row));
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
