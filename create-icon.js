const fs = require('fs');
const zlib = require('zlib');

function createPNG(width, height, pixelFn) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawData = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter byte
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y);
      rawData.push(r, g, b);
    }
  }

  const compressed = zlib.deflateSync(Buffer.from(rawData));

  function makeCrcTable() {
    const table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c;
    }
    return table;
  }

  const crcTable = makeCrcTable();

  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF);
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type);
    const crcData = Buffer.concat([typeB, data]);
    const crc = crc32(crcData);
    const crcB = Buffer.alloc(4);
    crcB.writeUInt32BE(crc >>> 0);
    return Buffer.concat([len, typeB, data, crcB]);
  }

  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

function pixel(x, y) {
  const size = 128;

  // Background: dark navy #1e1e2e
  let r = 30, g = 30, b = 46;

  // Subtle rounded rect background fill (slightly lighter)
  const margin = 6;
  const inBox = x >= margin && x < size - margin && y >= margin && y < size - margin;

  if (!inBox) return [r, g, b];

  // Letter "R" parameters
  // Vertical stroke: left pillar of R
  const vsX1 = 36, vsX2 = 50;
  const vsY1 = 22, vsY2 = 106;

  // Top cap horizontal bar
  const topY1 = 22, topY2 = 36;
  const topX1 = 36, topX2 = 82;

  // Middle bar
  const midY1 = 61, midY2 = 74;
  const midX1 = 36, midX2 = 80;

  // Bump (right side arch of R): semicircle from y=22 to y=74, centered at x=66, y=48
  const archCX = 66, archCY = 48, archR = 26, archInner = 16;
  const dx = x - archCX, dy = y - archCY;
  const dist2 = dx * dx + dy * dy;
  const inArch = dist2 <= archR * archR && dist2 >= archInner * archInner && x > archCX && y >= topY1 && y <= midY1 + 1;

  // Diagonal leg: from bottom-right of mid bar down to bottom-right
  // Goes from (80, 74) to (106, 106)
  const legProgress = (y - 74) / 32.0;
  const legCenterX = 80 + legProgress * 26;
  const legThick = 7;
  const inLeg = y >= 74 && y <= 106 && x >= legCenterX - legThick && x <= legCenterX + legThick;

  const inVStroke = x >= vsX1 && x <= vsX2 && y >= vsY1 && y <= vsY2;
  const inTopBar = x >= topX1 && x <= topX2 && y >= topY1 && y <= topY2;
  const inMidBar = x >= midX1 && x <= midX2 && y >= midY1 && y <= midY2;

  if (inVStroke || inTopBar || inMidBar || inArch || inLeg) {
    // Cyan #00d4ff
    r = 0; g = 212; b = 255;
  }

  return [r, g, b];
}

const png = createPNG(128, 128, pixel);
const outPath = 'C:\\Users\\vimal\\Desktop\\Ghost_Chat\\REZO\\icon.png';
fs.writeFileSync(outPath, png);
console.log('Icon created: icon.png (' + png.length + ' bytes)');
