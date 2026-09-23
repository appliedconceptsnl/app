/* ---------------------------------------------------------------------
   Applied Concepts — QR code printed small on every target/oefenschijf,
   linking straight to the live app (https://appliedconceptsnl.github.io/app/).

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
const QR_APP_URL = 'https://appliedconceptsnl.github.io/app/';
const QR_APP_MATRIX = [
  '000000000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000000000',
  '000011111110111011101110000100001011111110000',
  '000010000010111000100010110010110010000010000',
  '000010111010111100001011110110001010111010000',
  '000010111010010010000100001011100010111010000',
  '000010111010000011111001110011000010111010000',
  '000010000010110001001110100001111010000010000',
  '000011111110101010101010101010101011111110000',
  '000000000000100111000100010011001000000000000',
  '000000111010100010010001111000100111001110000',
  '000010111100010100111100111101010101011100000',
  '000010011010000010110101000101111011000110000',
  '000000011001110110111111111100101010000010000',
  '000001111010111010010010001011101110111110000',
  '000011100100110010000000100110001100011000000',
  '000011010010100111001001011101011110010110000',
  '000000011001011001111000111000110011100010000',
  '000001101011000010001101101001100110101010000',
  '000000100001110101110111100101001001001000000',
  '000010111010010011001101011100011101010110000',
  '000011101000100100110001101010001001000010000',
  '000001101011111011010000111101100111111000000',
  '000001101101101101100101101100100001010000000',
  '000000000111000010001110100010010010001110000',
  '000011001001001100100000010010100011000000000',
  '000000110010100001110111000000000110111100000',
  '000010101000111001110100101010100101001100000',
  '000010110010110100100111010000010011101110000',
  '000010001000001000011111101010110101110010000',
  '000010111011001101100111110011111111111010000',
  '000000000000100010110110110110111000100100000',
  '000011111110010110101100100010101010110110000',
  '000010000010000011000100101110101000100010000',
  '000010111010100010111111101011111111101010000',
  '000010111010100000111011110000101010111000000',
  '000010111010101010100110110110100101000010000',
  '000010000010000001010001000100111010100010000',
  '000011111110010101001100100111100101111110000',
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
