/** Small helpers for reading model-supplied arguments defensively. */
export function argString(args, key, fallback = '') {
    const value = args[key];
    return typeof value === 'string' ? value.trim() : fallback;
}
export function argNumber(args, key, fallback) {
    const value = args[key];
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
        return Number(value);
    return fallback;
}
export function argStringArray(args, key) {
    const value = args[key];
    if (Array.isArray(value))
        return value.filter((item) => typeof item === 'string');
    if (typeof value === 'string' && value.trim() !== '')
        return [value.trim()];
    return [];
}
export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
//# sourceMappingURL=types.js.map