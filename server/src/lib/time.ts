export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
