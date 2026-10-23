export {};
function normalizeAccountRef(rawRef: any): string {
    if (rawRef === undefined || rawRef === null) return '';
    if (Array.isArray(rawRef)) {
        return normalizeAccountRef(rawRef[0]);
    }
    return String(rawRef).trim();
}

function buildAccountKeys(account: any): Set<string> {
    const keys: Set<string> = new Set();
    const push = (value: any): void => {
        const next: string = normalizeAccountRef(value);
        if (next) keys.add(next);
    };
    push(account && account.id);
    push(account && account.uin);
    push(account && account.qq);
    return keys;
}

function findAccountByRef(accounts: any, rawRef: any): any {
    const key: string = normalizeAccountRef(rawRef);
    if (!key) return null;

    const list: any[] = Array.isArray(accounts) ? accounts : [];
    for (const account of list) {
        if (!account || typeof account !== 'object') continue;
        const keys: Set<string> = buildAccountKeys(account);
        if (keys.has(key)) {
            return account;
        }
    }
    return null;
}

function resolveAccountId(accounts: any, rawRef: any): string {
    const found: any = findAccountByRef(accounts, rawRef);
    if (!found) return '';
    return normalizeAccountRef(found.id);
}

module.exports = {
    normalizeAccountRef,
    findAccountByRef,
    resolveAccountId,
};
