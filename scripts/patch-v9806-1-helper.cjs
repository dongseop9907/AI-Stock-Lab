const fs = require('node:fs');

const p = './scripts/v9806-1.cjs';
const b = fs.readFileSync(p);

const startMarker = Buffer.from('function valueAfterSubLabel(', 'ascii');
const endMarker = Buffer.from('function gcd(', 'ascii');

const start = b.indexOf(startMarker);
const end = b.indexOf(endMarker, start);

if (start < 0 || end < 0 || end <= start) {
  throw new Error('VALUE_AFTER_SUBLABEL_BOUNDARY_NOT_FOUND');
}

const replacement = Buffer.from(`function valueAfterSubLabel(
  nodes,
  heading,
  subLabel,
  parser,
  maxWindow = 20,
  start = 0,
) {
  const headingIndex =
    findIndex(
      nodes,
      heading,
      start,
    );

  if (headingIndex < 0) {
    return null;
  }

  const end =
    Math.min(
      nodes.length,
      headingIndex + maxWindow,
    );

  for (
    let index = headingIndex + 1;
    index < end;
    index += 1
  ) {
    const labelMatches =
      typeof subLabel === 'string'
        ? nodes[index] === subLabel
        : subLabel.test(nodes[index]);

    if (!labelMatches) {
      continue;
    }

    const valueIndex = index + 1;

    if (valueIndex >= end) {
      return null;
    }

    return parser(nodes[valueIndex]);
  }

  return null;
}

`, 'ascii');

fs.writeFileSync(
  p,
  Buffer.concat([
    b.subarray(0, start),
    replacement,
    b.subarray(end),
  ]),
);

console.log('BYTE_SAFE_PATCH_APPLIED');

