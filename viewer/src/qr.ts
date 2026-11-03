// A QR code for a link, drawn here so the link never leaves the machine for a
// service. Byte mode at error correction level M, versions 1 to 20: past that the
// modules get too small to scan off a laptop screen, so a longer link has no code.
// Follows ISO/IEC 18004, in the shape of Project Nayuki's reference encoder (MIT).

const MAX_VERSION = 20;

// By version, from 1: error correction codewords per block, and blocks, at level M.
const ECC_PER_BLOCK = [
  10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
];
const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];
// Level M's two bits in the format information.
const LEVEL_BITS = 0;

const bit = (x: number, i: number): boolean => ((x >>> i) & 1) !== 0;

// Modules left for data and error correction once the fixed patterns are placed.
function rawModules(version: number): number {
  let n = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (version >= 7) n -= 36;
  }
  return n;
}

const dataCodewords = (version: number): number =>
  Math.floor(rawModules(version) / 8) - ECC_PER_BLOCK[version - 1] * BLOCKS[version - 1];

// The character count takes 8 bits below version 10 and 16 from there.
const countBits = (version: number): number => (version < 10 ? 8 : 16);

function fitVersion(bytes: number): number | null {
  for (let v = 1; v <= MAX_VERSION; v++) {
    if (4 + countBits(v) + 8 * bytes <= dataCodewords(v) * 8) return v;
  }
  return null;
}

function dataStream(bytes: Uint8Array, version: number): number[] {
  const bits: boolean[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push(bit(value, i));
  };
  // Byte mode.
  push(0b0100, 4);
  push(bytes.length, countBits(version));
  for (const b of bytes) push(b, 8);
  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] ? 1 : 0);
    out.push(byte);
  }
  return out;
}

const zeros = (n: number): number[] => Array.from({ length: n }, () => 0);

// Multiplication in GF(2^8) over the polynomial 0x11D.
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result = zeros(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = zeros(divisor.length);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= gfMul(coef, factor)));
  }
  return result;
}

// Splits the data into blocks, adds each one's error correction, and interleaves.
function withErrorCorrection(data: number[], version: number): number[] {
  const blocks = BLOCKS[version - 1];
  const eccLen = ECC_PER_BLOCK[version - 1];
  const raw = Math.floor(rawModules(version) / 8);
  const short = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const divisor = rsDivisor(eccLen);
  const all: number[][] = [];
  for (let i = 0, at = 0; i < blocks; i++) {
    const len = shortLen - eccLen + (i < short ? 0 : 1);
    const dat = data.slice(at, at + len);
    at += len;
    const ecc = rsRemainder(dat, divisor);
    // A placeholder evens the short blocks up, and the walk below skips it.
    if (i < short) dat.push(0);
    all.push(dat.concat(ecc));
  }
  const out: number[] = [];
  for (let i = 0; i < all[0].length; i++) {
    for (let j = 0; j < blocks; j++) {
      if (i !== shortLen - eccLen || j >= short) out.push(all[j][i]);
    }
  }
  return out;
}

function alignmentPositions(version: number, size: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < count; pos -= step) out.splice(1, 0, pos);
  return out;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

// How hard a pattern is to read, by the standard's four rules, to choose a mask.
function penalty(m: boolean[][]): number {
  const size = m.length;
  let score = 0;
  const finder = [true, false, true, true, true, false, true];
  const quiet = [false, false, false, false];
  const line = (at: (i: number) => boolean) => {
    let run = 0;
    let prev = false;
    for (let i = 0; i < size; i++) {
      const v = at(i);
      if (i > 0 && v === prev) {
        run++;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else {
        run = 1;
      }
      prev = v;
    }
    const matches = (from: number, pattern: boolean[]) =>
      pattern.every((p, k) => at(from + k) === p);
    for (let i = 0; i + 11 <= size; i++) {
      if (matches(i, finder) && matches(i + 7, quiet)) score += 40;
      if (matches(i, quiet) && matches(i + 4, finder)) score += 40;
    }
  };
  for (let i = 0; i < size; i++) {
    line((j) => m[i][j]);
    line((j) => m[j][i]);
  }
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++;
      if (
        y + 1 < size &&
        x + 1 < size &&
        m[y][x] === m[y][x + 1] &&
        m[y][x] === m[y + 1][x] &&
        m[y][x] === m[y + 1][x + 1]
      ) {
        score += 3;
      }
    }
  }
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

// The modules, row by row (true is dark), or null when the text won't fit a code
// that could still be scanned.
export function qrEncode(text: string): boolean[][] | null {
  const bytes = new TextEncoder().encode(text);
  const version = fitVersion(bytes.length);
  if (version === null) return null;
  const size = version * 4 + 17;
  const blank = () => Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  const modules = blank();
  const fixed = blank();
  const set = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark;
    fixed[y][x] = true;
  };

  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  const aligns = alignmentPositions(version, size);
  const last = aligns.length - 1;
  aligns.forEach((cx, i) => {
    aligns.forEach((cy, j) => {
      // The three corners a finder pattern already holds.
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    });
  });

  const drawFormat = (mask: number) => {
    const data = (LEVEL_BITS << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, bit(bits, i));
    set(8, 7, bit(bits, 6));
    set(8, 8, bit(bits, 7));
    set(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(bits, i));
    set(8, size - 8, true);
  };
  // Reserves its modules, so the data below goes around them.
  drawFormat(0);

  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit(bits, i));
      set(b, a, bit(bits, i));
    }
  }

  const stream = withErrorCorrection(dataStream(bytes, version), version);
  // Two columns at a time from the right, snaking up and down, around the timing column.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < size; vert++) {
      const y = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (!fixed[y][x] && i < stream.length * 8) {
          modules[y][x] = bit(stream[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!fixed[y][x] && MASKS[mask](x, y)) modules[y][x] = !modules[y][x];
      }
    }
  };
  let best = 0;
  let lowest = Infinity;
  for (let mask = 0; mask < MASKS.length; mask++) {
    applyMask(mask);
    drawFormat(mask);
    const score = penalty(modules);
    if (score < lowest) {
      lowest = score;
      best = mask;
    }
    // A mask is its own undo.
    applyMask(mask);
  }
  applyMask(best);
  drawFormat(best);
  return modules;
}

// The quiet zone the standard asks for around a code, in modules.
export const QR_QUIET = 4;

// One SVG path of the dark modules, a run per row, so the file stays small and
// neighbouring modules never show a hairline between them.
export function qrPath(modules: boolean[][]): string {
  let d = "";
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      let run = 1;
      while (x + run < row.length && row[x + run]) run++;
      d += `M${x + QR_QUIET} ${y + QR_QUIET}h${run}v1h-${run}z`;
      x += run - 1;
    }
  });
  return d;
}
