// characters file systems refuse or treat specially: control characters and < > : " / \ | ? *
// eslint-disable-next-line no-control-regex -- control characters are what this removes
const BAD = /[\u0000-\u001f\u007f<>:"/\\|?*]/g;

/**
 * A build name made safe as a downloaded file's name.
 *
 * The part before the extension gets "_" for every character file systems refuse or treat
 * specially (path separators, control characters, < > : " | ? *) and loses leading and trailing
 * dots and spaces; an empty name becomes "build".
 *
 * @param name The file name, extension included ("Fire Farmer.mbd").
 * @return The cleaned name.
 */
export function safeFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).replace(/[^\w.]/g, '') : '';
  const stem = (dot >= 0 ? name.slice(0, dot) : name).replace(BAD, '_').replace(/^[.\s]+|[.\s]+$/g, '');
  return `${stem || 'build'}${ext}`;
}
