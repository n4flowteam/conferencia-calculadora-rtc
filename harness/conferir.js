// Envia cada caso para a calculadora OFICIAL (API local) e para o motor do app, e compara campo a campo.
const fs = require("fs");
const M = require("./engine.js");
const [, , regrasP, nomesP, casosP, saidaDir, url] = process.argv;
const I = M.indexar(JSON.parse(fs.readFileSync(regrasP)), JSON.parse(fs.readFileSync(nomesP)));
const casos = JSON.parse(fs.readFileSync(casosP));
const num = (s) => { try { return new M.Decimal(String(s)); } catch (e) { return null; } };
function achatar(o, p = "", out = {}) {
  if (o == null) return out;
  if (typeof o !== "object") { out[p] = String(o); return out; }
  for (const [k, v] of Object.entries(o)) { if (k === "memoriaCalculo" || v == null) continue; achatar(v, p ? p + "." + k : k, out); }
  return out;
}
const S = (x) => x == null ? null : String(x);
function minha(r) {
  const g = r.IBSCBS.gIBSCBS;
  const red = (x) => x ? { pRedAliq: S(x.pRedAliq), pAliqEfet: S(x.pAliqEfet) } : null, dif = (x) => x ? { pDif: S(x.pDif), vDif: S(x.vDif) } : null;
  return {
    IS: r.IS ? { CSTIS: r.IS.CSTIS, cClassTribIS: r.IS.cClassTribIS, vBCIS: S(r.IS.vBCIS), pIS: S(r.IS.pIS), pISEspec: S(r.IS.pISEspec), adRemIS: S(r.IS.pISEspec), uTrib: r.IS.uTrib, qTrib: S(r.IS.qTrib), vIS: S(r.IS.vIS) } : null,
    IBSCBS: { CST: r.IBSCBS.CST, cClassTrib: r.IBSCBS.cClassTrib, gIBSCBS: g ? {
      vBC: S(g.vBC),
      gIBSUF: g.gIBSUF ? { pIBSUF: S(g.gIBSUF.pIBSUF), gDif: dif(g.gIBSUF.gDif), gRed: red(g.gIBSUF.gRed), vIBSUF: S(g.gIBSUF.vIBSUF) } : null,
      gIBSMun: g.gIBSMun ? { pIBSMun: S(g.gIBSMun.pIBSMun), gDif: dif(g.gIBSMun.gDif), gRed: red(g.gIBSMun.gRed), vIBSMun: S(g.gIBSMun.vIBSMun) } : null,
      vIBS: S(g.vIBS),
      gCBS: g.gCBS ? { pCBS: S(g.gCBS.pCBS), gDif: dif(g.gCBS.gDif), gRed: red(g.gCBS.gRed), vCBS: S(g.gCBS.vCBS) } : null,
      gTribRegular: g.gTribRegular ? Object.fromEntries(Object.entries(g.gTribRegular).map(([k, v]) => [k, S(v)])) : null,
    } : null },
  };
}
function comparar(a, b) {
  const A = achatar(a), B = achatar(b), difs = [];
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const x = A[k], y = B[k];
    if (x === undefined || y === undefined) { difs.push({ campo: k, oficial: x ?? null, app: y ?? null }); continue; }
    const nx = /^-?\d+(\.\d+)?$/.test(x) ? num(x) : null, ny = /^-?\d+(\.\d+)?$/.test(y) ? num(y) : null;
    if (nx && ny ? !nx.eq(ny) : x !== y) difs.push({ campo: k, oficial: x, app: y });
  }
  return difs;
}
const corpo = (c) => ({ id: "conf-" + c.id, versao: "1.0.0", dhFatoGerador: c.data + "T12:00:00-03:00", municipio: 3550308, uf: "SP",
  itens: [Object.assign({ numero: 1 }, JSON.parse(JSON.stringify(c.item, (k, v) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && ["baseCalculo", "quantidade", "impostoInformado"].includes(k)) ? Number(v) : v)))] });
async function oficial(c) {
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo(c)) });
      const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {}
      return { status: r.status, json: j, texto: j ? null : txt.slice(0, 500) };
    } catch (e) { await new Promise((s) => setTimeout(s, 500 * (t + 1))); }
  }
  return { status: 0, json: null, texto: "sem resposta" };
}
(async () => {
  const res = { total: 0, iguais: 0, divergentes: 0, porTipo: {}, erroAmbos: 0, mensagemDiferente: 0, sucessoAmbos: 0 }, divergencias = [], mensagens = [], amostras = [];
  let i = 0;
  const trabalhador = async () => { while (i < casos.length) { const c = casos[i++];
    const of = await oficial(c);
    let app = null, appErro = null;
    try { app = M.calcular(I, { data: c.data, item: c.item }); } catch (e) { appErro = { tipo: e.tipo || "js", mensagem: e.message }; }
    res.total++;
    const okOficial = of.status === 200 && of.json && of.json.objetos;
    let tipo = null, detalhe = null;
    if (okOficial && app) {
      const trib = of.json.objetos[0].tribCalc;
      const difs = comparar({ IS: trib.IS || null, IBSCBS: { CST: trib.IBSCBS && trib.IBSCBS.CST, cClassTrib: trib.IBSCBS && trib.IBSCBS.cClassTrib, gIBSCBS: trib.IBSCBS && trib.IBSCBS.gIBSCBS || null } }, minha(app));
      const simul = !!of.json.objetos[0].calculoSimulado === !!app.calculoSimulado;
      if (difs.length || !simul) { tipo = "valores"; detalhe = { difs, calculoSimulado: { oficial: of.json.objetos[0].calculoSimulado, app: app.calculoSimulado } }; } else { res.sucessoAmbos++; if (amostras.length < 40 && c.id % 97 === 0) amostras.push({ caso: c, oficial: trib }); }
    } else if (!okOficial && appErro) {
      res.erroAmbos++;
      const msgOf = (of.json && (of.json.detail || of.json.title)) || of.texto || "";
      if (msgOf.trim() !== appErro.mensagem.trim()) { res.mensagemDiferente++; if (mensagens.length < 400) mensagens.push({ caso: c, status: of.status, oficial: msgOf, app: appErro }); }
    } else if (okOficial && appErro) { tipo = "app-erro-oficial-calcula"; detalhe = { app: appErro, oficial: of.json.objetos[0].tribCalc }; }
    else { tipo = "app-calcula-oficial-erro"; detalhe = { status: of.status, oficial: (of.json && (of.json.detail || of.json.title)) || of.texto, app: app && minha(app) }; }
    if (tipo) { res.divergentes++; res.porTipo[tipo] = (res.porTipo[tipo] || 0) + 1; if (divergencias.length < 600) divergencias.push({ tipo, caso: c, detalhe }); } else res.iguais++;
    if (res.total % 2000 === 0) console.log(`${res.total}/${casos.length} conferidos, ${res.divergentes} divergências`);
  } };
  await Promise.all(Array.from({ length: 12 }, trabalhador));
  fs.writeFileSync(saidaDir + "/resumo.json", JSON.stringify(res, null, 1));
  fs.writeFileSync(saidaDir + "/divergencias.json", JSON.stringify(divergencias, null, 1));
  fs.writeFileSync(saidaDir + "/mensagens_diferentes.json", JSON.stringify(mensagens, null, 1));
  fs.writeFileSync(saidaDir + "/amostras_ok.json", JSON.stringify(amostras, null, 1));
  console.log(JSON.stringify(res));
})();
