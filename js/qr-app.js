/* ---------------------------------------------------------------------
   Applied Concepts — QR code printed small on every target/oefenschijf,
   linking straight to the live app (https://joppng.github.io/zero-calculator/).

   The module grid below is a pre-computed QR code (version 5, 37x37
   modules + the standard 4-module quiet zone = 45x45, error-correction
   level H) for that fixed URL. It's baked in as plain data instead of
   generated at runtime — the URL never changes, so there's no encoding
   library to ship, and no risk of a hand-rolled Reed-Solomon bug ending
   up on a printed sheet. Regenerate with any QR library if the URL ever
   changes (Python: qrcode.QRCode(error_correction=ERROR_CORRECT_H,
   border=4).add_data(url) -> get_matrix()).

   Level H tolerates ~30% of the code being obstructed, which is what
   makes it safe to drop the Applied Concepts mark in the middle: the
   logo + its white halo cover about 20% of the area, tested (down to a
   12mm print, well below anything a target sheet would actually use) to
   still scan reliably.
--------------------------------------------------------------------- */
const QR_APP_URL = 'https://joppng.github.io/zero-calculator/';
const QR_APP_MATRIX = [
  '000000000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000000000',
  '000011111110011001101000101110100011111110000',
  '000010000010011101001000100010000010000010000',
  '000010111010100101000111100001110010111010000',
  '000010111010111110000011000011101010111010000',
  '000010111010011110010101010001100010111010000',
  '000010000010000011111100000111100010000010000',
  '000011111110101010101010101010101011111110000',
  '000000000000001101000010001001011000000000000',
  '000000011011011111110011111101001000011000000',
  '000001001000111111001011011101111101101000000',
  '000001011111010111001100101101010111101010000',
  '000010000100001101010001010110111110011100000',
  '000000111110101011000101110000011010000000000',
  '000010111001110111110111101100111100101100000',
  '000010000011110000000101011011011100111110000',
  '000001101100010110111101001100111001011010000',
  '000010001110100111100010111101011010001110000',
  '000001010000001101001011010001110100001100000',
  '000010010010100010001010011001010100011010000',
  '000000010001101000010100010001000000110110000',
  '000011100111001011111100011110101110110000000',
  '000001111001110001110111111101111001100000000',
  '000000011111000010110100011111010010100010000',
  '000001001101100100000011110001011111011110000',
  '000000010111110101001101100111000011010000000',
  '000010111001001010100010011000111000110000000',
  '000011100110100100101000100110010011001010000',
  '000010101101010101101011111100110101011000000',
  '000010110110011001001101001011001111111110000',
  '000000000000111111101110011000011000111000000',
  '000011111110101000100001110101001010111010000',
  '000010000010000010010001000011011000110100000',
  '000010111010110001100111001000111111100100000',
  '000010111010101011010101100010111010010000000',
  '000010111010010000111010101101100000111110000',
  '000010000010001010100100101110100011111110000',
  '000011111110000111001000111110001000010010000',
  '000000000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000000000'
];

// Draws the QR code (with the Applied Concepts mark inset at the center)
// inside a size x size inch box, top-left corner at (x, y). Uses the same
// LOGO_BLACK_INNER/LOGO_VIEWBOX/LOGO_ASPECT constants as the sheet header
// logos (js/app.js) — no separate logo asset needed, and it stays in sync
// with the brand mark automatically.
function buildAppQrSvg(x, y, size){
  const n = QR_APP_MATRIX.length;
  const m = size / n;
  let s = `<g>`;
  s += `<rect x="${x.toFixed(4)}" y="${y.toFixed(4)}" width="${size.toFixed(4)}" height="${size.toFixed(4)}" fill="#fff"/>`;
  for(let row = 0; row < n; row++){
    const line = QR_APP_MATRIX[row];
    for(let col = 0; col < n; col++){
      if(line[col] === '1'){
        s += `<rect x="${(x+col*m).toFixed(4)}" y="${(y+row*m).toFixed(4)}" width="${(m+0.001).toFixed(4)}" height="${(m+0.001).toFixed(4)}" fill="#171510"/>`;
      }
    }
  }
  // Center mark: white halo (so it reads clean against the modules behind
  // it) plus the logo, scaled to fit — together about 20% of the code's
  // width, well inside level H's ~30% error-correction budget.
  const cx = x + size/2, cy = y + size/2;
  const haloSize = size * 0.24;
  const logoSize = size * 0.19;
  s += `<rect x="${(cx-haloSize/2).toFixed(4)}" y="${(cy-haloSize/2).toFixed(4)}" width="${haloSize.toFixed(4)}" height="${haloSize.toFixed(4)}" fill="#fff"/>`;
  s += `<svg x="${(cx-logoSize/2).toFixed(4)}" y="${(cy-logoSize/2).toFixed(4)}" width="${logoSize.toFixed(4)}" height="${logoSize.toFixed(4)}" viewBox="${LOGO_VIEWBOX}">${LOGO_BLACK_INNER}</svg>`;
  s += `</g>`;
  return s;
}
