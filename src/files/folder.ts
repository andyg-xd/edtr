/** One editable file in an opened folder. Mirrors the Rust `FolderEntry`
 * returned by the `read_folder` command. */
export interface FolderEntry {
  name: string;
  path: string;
}
