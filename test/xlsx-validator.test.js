import test from 'node:test';
import assert from 'node:assert/strict';
import { listZipEntries, validateXlsxBuffer } from '../src/xlsx-validator.js';

function localFile(name, data) {
  const nameBuffer = Buffer.from(name);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBuffer, data]);
}

function centralDirectoryEntry(name, data, offset) {
  const nameBuffer = Buffer.from(name);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, nameBuffer]);
}

function endOfCentralDirectory(centralDirectoryOffset, centralDirectorySize, entries) {
  const header = Buffer.alloc(22);
  header.writeUInt32LE(0x06054b50, 0);
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(entries, 8);
  header.writeUInt16LE(entries, 10);
  header.writeUInt32LE(centralDirectorySize, 12);
  header.writeUInt32LE(centralDirectoryOffset, 16);
  header.writeUInt16LE(0, 20);
  return header;
}

function makeXlsxBuffer(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, data] of files) {
    const local = localFile(name, data);
    localParts.push(local);
    centralParts.push(centralDirectoryEntry(name, data, offset));
    offset += local.length;
  }

  const localBuffer = Buffer.concat(localParts);
  const centralBuffer = Buffer.concat(centralParts);
  const eocd = endOfCentralDirectory(localBuffer.length, centralBuffer.length, files.length);

  return Buffer.concat([localBuffer, centralBuffer, eocd]);
}

test('validateXlsxBuffer accepts a minimal XLSX ZIP', () => {
  const buffer = makeXlsxBuffer([
    ['[Content_Types].xml', Buffer.from('<Types/>')],
    ['xl/workbook.xml', Buffer.from('<workbook/>')],
    ['xl/worksheets/sheet1.xml', Buffer.from('<worksheet/>')],
  ]);
  const names = listZipEntries(buffer);
  const validation = validateXlsxBuffer(buffer);

  assert.deepEqual(names, ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
  assert.equal(validation.valid, true);
});

test('validateXlsxBuffer rejects missing workbook parts', () => {
  const buffer = makeXlsxBuffer([
    ['[Content_Types].xml', Buffer.from('<Types/>')],
    ['not-xlsx.txt', Buffer.from('hello')],
  ]);
  const validation = validateXlsxBuffer(buffer);

  assert.equal(validation.valid, false);
  assert.match(validation.error, /xl\/workbook\.xml/);
});
