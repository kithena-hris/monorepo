import PDFDocument from 'pdfkit';

import type { CvDraft } from '../application/accounts.js';

/**
 * A CV as one clean PDF (A4, Helvetica, the fonts pdfkit ships): the name
 * and headline, contact, a summary, then experience, education, skills and
 * languages. The same shape every time, so a recruiter's parser reads it the
 * way it reads any other CV.
 */

const MARGIN = 56;
const INK = '#111111';
const MUTED = '#555555';
const RULE = '#DDDDDD';

export async function renderCv(cv: CvDraft): Promise<Uint8Array> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: { Title: `${cv.name} · CV` } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const ended = new Promise<void>((resolve) => doc.on('end', resolve));
  const width = doc.page.width - MARGIN * 2;

  doc.font('Helvetica-Bold').fontSize(22).fillColor(INK).text(cv.name, { width });
  if (cv.headline !== '')
    doc.font('Helvetica').fontSize(12).fillColor(MUTED).text(cv.headline, { width });
  const contact = [cv.email, cv.phone, cv.location].filter(
    (x): x is string => typeof x === 'string' && x !== '',
  );
  if (contact.length > 0)
    doc
      .moveDown(0.3)
      .font('Helvetica')
      .fontSize(9.5)
      .fillColor(MUTED)
      .text(contact.join('  ·  '), { width });

  const heading = (text: string): void => {
    doc.moveDown(1);
    const y = doc.y;
    doc
      .moveTo(MARGIN, y)
      .lineTo(MARGIN + width, y)
      .lineWidth(0.6)
      .strokeColor(RULE)
      .stroke();
    doc.moveDown(0.4);
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(INK)
      .text(text.toUpperCase(), { width, characterSpacing: 0.6 });
    doc.moveDown(0.3);
  };
  const entries = (list: CvDraft['experience']): void => {
    for (const e of list) {
      const when = [e.from, e.to].filter((x) => x !== '').join(' – ');
      doc
        .font('Helvetica-Bold')
        .fontSize(10.5)
        .fillColor(INK)
        .text(e.title, { width, continued: when !== '' });
      if (when !== '') doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(`   ${when}`);
      if (e.organisation !== '')
        doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(e.organisation, { width });
      for (const b of e.bullets)
        doc.font('Helvetica').fontSize(10).fillColor(INK).text(`•  ${b}`, { width, indent: 0 });
      doc.moveDown(0.6);
    }
  };

  if (cv.summary !== '') {
    heading('Profile');
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(cv.summary, { width, lineGap: 2 });
  }
  if (cv.experience.length > 0) {
    heading('Experience');
    entries(cv.experience);
  }
  if (cv.education.length > 0) {
    heading('Education');
    entries(cv.education);
  }
  if (cv.skills.length > 0) {
    heading('Skills');
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(INK)
      .text(cv.skills.join('  ·  '), { width, lineGap: 2 });
  }
  if (cv.languages.length > 0) {
    heading('Languages');
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(cv.languages.join('  ·  '), { width });
  }
  doc.end();
  await ended;
  return new Uint8Array(Buffer.concat(chunks));
}
