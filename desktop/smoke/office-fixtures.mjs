import { createRequire } from "node:module";
export async function officeFixtures() {
  const requireOffice = createRequire(
    new URL("../extensions/visuals/package.json", import.meta.url),
  );
  const ExcelJS = requireOffice("exceljs");
  const Zip = createRequire(requireOffice.resolve("exceljs"))("jszip");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Local sheet");
  for (let row = 0; row < 150; row++)
    sheet.addRow([row === 0 ? "Local spreadsheet" : `row ${row}`, row]);
  sheet.mergeCells("A1:B1");
  const xlsxZip = await Zip.loadAsync(await workbook.xlsx.writeBuffer({ useSharedStrings: true }));
  const strings = xlsxZip.file("xl/sharedStrings.xml");
  xlsxZip.file(
    "xl/sharedStrings.xml",
    (await strings.async("string")).replace(
      "<si><t>Local spreadsheet</t></si>",
      "<si><t></t><r><t>Local spreadsheet</t></r></si>",
    ),
  );
  const workbookXml = xlsxZip.file("xl/workbook.xml");
  xlsxZip.file(
    "xl/workbook.xml",
    (await workbookXml.async("string")).replace(
      'name="Local sheet"',
      'name="Local sheet with an extended descriptive name"',
    ),
  );
  const xlsx = await xlsxZip.generateAsync({ type: "nodebuffer" });
  const word = new Zip();
  word.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  word.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  word.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      Array.from(
        { length: 100 },
        (_, index) =>
          `<w:p>${index === 35 || index === 70 ? '<w:r><w:br w:type="page"/></w:r>' : ""}<w:r><w:t>Local Word paragraph ${index}</w:t></w:r></w:p>`,
      ).join("") +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>',
  );
  const docx = await word.generateAsync({ type: "nodebuffer" });
  const ppt = new Zip();
  ppt.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
  );
  ppt.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
  );
  ppt.file(
    "ppt/presentation.xml",
    '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
  );
  ppt.file(
    "ppt/_rels/presentation.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
  );
  ppt.file(
    "ppt/slides/slide1.xml",
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="6400800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="2400"><a:solidFill><a:srgbClr val="202020"/></a:solidFill></a:rPr><a:t>Local PowerPoint preview</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  );
  const pptx = await ppt.generateAsync({ type: "nodebuffer" });

  return { xlsx, docx, pptx };
}

export function pdfFixture() {
  let source = "%PDF-1.4\n";
  const offsets = [0];
  const stream = "0 0 0 rg 40 260 100 100 re f\n";
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Count 3/Kids[3 0 R 3 0 R 3 0 R]>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 400]/Contents 4 0 R>>",
    `<</Length ${stream.length}>>\nstream\n${stream}endstream`,
  ];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(source);
  source += `xref\n0 5\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<</Size 5/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(source);
}
