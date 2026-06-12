const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const MAX_EOCD_SIZE = 65557;

function findEndOfCentralDirectory(buffer) {
  const start = Math.max(0, buffer.length - MAX_EOCD_SIZE);

  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }

  return null;
}

export function listZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error('Ожидается Buffer');
  if (buffer.length < 22) throw new Error('Слишком маленький ZIP-файл');

  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset === null) throw new Error('ZIP EOCD не найден');

  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);

  if (centralDirectoryOffset < 0 || centralDirectoryOffset + 46 > buffer.length) {
    throw new Error('Некорректное смещение central directory');
  }

  const names = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length) throw new Error('Central directory обрезан');
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('Некорректная запись central directory');
    }

    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;

    if (fileNameEnd > buffer.length) throw new Error('Имя файла в ZIP обрезано');

    names.push(buffer.subarray(fileNameStart, fileNameEnd).toString('utf8'));
    offset = fileNameEnd + extraLength + commentLength;
  }

  return names;
}

export function validateXlsxBuffer(buffer) {
  let names;
  try {
    names = listZipEntries(buffer);
  } catch (error) {
    return {
      valid: false,
      error: `Некорректный ZIP/XLSX: ${error.message}`,
    };
  }

  const required = ['[Content_Types].xml', 'xl/workbook.xml'];
  const missing = required.filter((name) => !names.includes(name));

  if (missing.length > 0) {
    return {
      valid: false,
      error: `Некорректный XLSX: отсутствуют ${missing.join(', ')}`,
    };
  }

  return {
    valid: true,
    entries: names.length,
  };
}
