const createMemoryStorage = (): Storage => {
    const values = new Map<string, string>();

    return {
        clear: () => values.clear(),
        getItem: (key) => values.get(String(key)) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        get length() {
            return values.size;
        },
        removeItem: (key) => {
            values.delete(String(key));
        },
        setItem: (key, value) => {
            values.set(String(key), String(value));
        },
    };
};

const storage = createMemoryStorage();

Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
});

if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: storage,
    });
}
