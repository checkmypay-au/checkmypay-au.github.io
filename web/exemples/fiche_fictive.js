// Fiche de paie FICTIVE au format_a, fabriquée en PDF à la volée (aucun fichier .pdf stocké : *.pdf est
// exclu du dépôt). Valeurs inventées, cohérentes avec humanforce_fictif.txt et les taux Level 2 au 2026-07-01.
// Cycle Q4+Q5 : heures et montants refaits, sans aucun lien avec de vraies fiches (contrôle L2).
// Écart volontaire : 3 h de soirée payées au lieu de 4 (il manque 2,95 $).
// Module pur : aucun import, utilisable par la page et par les tests Node.

const T = (x, y, str) => ({ x, y, str });

export const MORCEAUX_FICTIFS = [
  // Classification inventée ; son nombre (2) et le taux de base 27.08 désignent tous deux le niveau 2.
  T(40, 700, 'Classification: Fictive Food Bev Att 2 Cas'),
  T(300, 700, 'Pay Period: 17Aug26 to 23Aug26'),
  T(100, 690, 'Rate: 27.080000'), T(300, 690, 'Period: 8'), T(380, 690, 'Pay Date: 26Aug26'),
  T(250, 680, 'PAYSLIP'),
  T(40, 670, 'This Pay'), T(130, 670, '830.05'), T(210, 670, '0.00'), T(270, 670, '830.05'),
  T(340, 670, '0.00'), T(400, 670, '137.00'), T(450, 670, '693.05'),
  T(40, 650, 'Payments and Allowances'), T(370, 650, 'Deductions and Tax'),
  T(40, 640, 'Description'), T(200, 640, 'Hours'), T(280, 640, 'Rate'), T(320, 640, 'Amount'),
  T(360, 640, '| Description'), T(460, 640, 'Amount'),
  T(40, 630, 'Ord Casual'), T(210, 630, '12.20'), T(280, 630, '33.85'), T(320, 630, '412.97'),
  T(360, 630, '| Tax'), T(460, 630, '137.00'),
  T(40, 620, 'Penalty 7pm to Midni'), T(210, 620, '3.00'), T(280, 620, '2.95'), T(320, 620, '8.85'),
  T(40, 610, 'Saturday Casual'), T(210, 610, '6.20'), T(280, 610, '40.62'), T(320, 610, '251.84'),
  T(40, 600, 'Sunday Casual'), T(210, 600, '3.30'), T(280, 600, '47.39'), T(320, 600, '156.39'),
  T(360, 590, '|'),
  T(360, 585, '| Pre-Tax deductions'),
  T(40, 580, 'Net Pay Disbursement'), T(360, 580, '| Benefits'),
  T(360, 570, '| SG Cont'), T(460, 570, '99.61'), T(520, 570, '99.61'),
  T(40, 560, 'Super Fund'),
];

/** Texte PDF littéral : ( ) et \ échappés ; ASCII seulement. */
function litteral(s) {
  if (!/^[\x20-\x7e]*$/.test(s)) throw new Error(`Caractère non ASCII dans la fiche fictive : « ${s} »`);
  return '(' + s.replace(/[\\()]/g, (c) => '\\' + c) + ')';
}

/** PDF 1.4 minimal d'une page A4, police Helvetica, un objet texte par morceau. */
export function octetsFicheFictive(morceaux = MORCEAUX_FICTIFS) {
  const flux = morceaux.map((m) => `BT /F1 8 Tf ${m.x} ${m.y} Td ${litteral(m.str)} Tj ET`).join('\n');
  const objets = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const positions = [];
  objets.forEach((o, i) => {
    positions.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  pdf += positions.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export const NOM_FICHE_FICTIVE = 'fiche_fictive_2026-08-17.pdf';
