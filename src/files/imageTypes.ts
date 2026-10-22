/**
 * The picture types Edtr inserts, displays and embeds. Kept free of any Tauri
 * import so pure modules (the export pipeline) can use it without gaining a
 * route to a command.
 */
export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] as const;
