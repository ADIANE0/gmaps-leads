function doPost(e) {
  var d = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = String(d.sheet || 'Leads').replace(/[\[\]\*\?\/\\:]/g, ' ').slice(0, 90);
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(d.headers);
  if (d.rows.length) sh.getRange(sh.getLastRow() + 1, 1, d.rows.length, d.headers.length).setValues(d.rows);
  return ContentService.createTextOutput(JSON.stringify({ ok: true, added: d.rows.length }));
}
