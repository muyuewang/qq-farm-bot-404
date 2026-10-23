/*
 * Decode the mystery-shop and mall captures produced by the websocket recorder.
 * Usage: node tools/decode-shop-protocols.js "C:\\Users\\liyp\\Downloads\\协议"
 * Requests are TSDK-encrypted; gateway responses and notifications are plaintext
 * protobuf bodies, so only message_type=1 is passed through decryptBuffer.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const coreRequire = createRequire(path.resolve(__dirname, '../core/package.json'));
const protobuf = coreRequire('protobufjs');
const cryptoWasm = require('../core/dist/utils/crypto-wasm');

const captureDir = path.resolve(process.argv[2] || 'C:/Users/liyp/Downloads/协议');
const protoDir = path.resolve(__dirname, '../core/src/proto');
const protoFiles = fs.readdirSync(protoDir).filter((name) => name.endsWith('.proto'))
    .map((name) => path.join(protoDir, name));
const root = new protobuf.Root().loadSync(protoFiles, { keepCase: true });
const gate = root.lookupType('gatepb.Message');
const event = root.lookupType('gatepb.EventMessage');
const types = {
    GetActiveNPCRequest: root.lookupType('gamepb.mysteryshoppb.GetActiveNPCRequest'),
    GetActiveNPCReply: root.lookupType('gamepb.mysteryshoppb.GetActiveNPCReply'),
    GetMallListBySlotTypeRequest: root.lookupType('gamepb.mallpb.GetMallListBySlotTypeRequest'),
    GetMallListBySlotTypeResponse: root.lookupType('gamepb.mallpb.GetMallListBySlotTypeResponse'),
    PurchaseRequest: root.lookupType('gamepb.mallpb.PurchaseRequest'),
    PurchaseResponse: root.lookupType('gamepb.mallpb.PurchaseResponse'),
    ItemNotify: root.lookupType('gamepb.itempb.ItemNotify'),
    NeedNotify: root.lookupType('gamepb.mallpb.NeedNotify'),
};

function print(file, service, method, type, body, encrypted) {
    let decoded;
    let roundtrip = false;
    let wire_diff;
    try {
        const message = type.decode(body);
        decoded = type.toObject(message, { longs: String, enums: String, bytes: String });
        const encoded = Buffer.from(type.encode(message).finish());
        roundtrip = encoded.equals(Buffer.from(body));
        if (!roundtrip) wire_diff = { input: Buffer.from(body).toString('hex'), encoded: encoded.toString('hex') };
    } catch (error) {
        decoded = { decode_error: String(error.message), body_hex: Buffer.from(body).toString('hex') };
    }
    process.stdout.write(JSON.stringify({ file, service, method, encrypted, roundtrip, wire_diff, decoded }) + '\n');
}

async function main() {
    const names = fs.readdirSync(captureDir).filter((name) => name.endsWith('.bin')).sort();
    for (const name of names) {
        let message;
        try {
            message = gate.decode(fs.readFileSync(path.join(captureDir, name)));
        } catch {
            // WebSocket ping/pong frames are captured alongside protobuf messages.
            continue;
        }
        const meta = message.meta || {};
        let service = String(meta.service_name || '');
        let method = String(meta.method_name || '');
        let body = Buffer.from(message.body || []);
        let encrypted = false;
        if (Number(meta.message_type) === 1 && body.length > 0) {
            encrypted = true;
            body = await cryptoWasm.decryptBuffer(body);
        } else if (Number(meta.message_type) === 3 && body.length > 0) {
            const notification = event.decode(body);
            service = service || String(notification.message_type || '');
            method = method || String(notification.message_type || '');
            body = Buffer.from(notification.body || []);
        }

        if (service === 'gamepb.mysteryshoppb.MysteryShopService' && method === 'GetActiveNPC') {
            print(name, service, method, Number(meta.message_type) === 1 ? types.GetActiveNPCRequest : types.GetActiveNPCReply, body, encrypted);
        } else if (service === 'gamepb.mallpb.MallService' && method === 'GetMallListBySlotType') {
            print(name, service, method, Number(meta.message_type) === 1 ? types.GetMallListBySlotTypeRequest : types.GetMallListBySlotTypeResponse, body, encrypted);
        } else if (service === 'gamepb.mallpb.MallService' && method === 'Purchase') {
            print(name, service, method, Number(meta.message_type) === 1 ? types.PurchaseRequest : types.PurchaseResponse, body, encrypted);
        } else if (service === 'gamepb.itempb.ItemNotify' || method === 'gamepb.itempb.ItemNotify') {
            print(name, service, method, types.ItemNotify, body, encrypted);
        } else if (service === 'gamepb.mallpb.NeedNotify' || method === 'gamepb.mallpb.NeedNotify') {
            print(name, service, method, types.NeedNotify, body, encrypted);
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
