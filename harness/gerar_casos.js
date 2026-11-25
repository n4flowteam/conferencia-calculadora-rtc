// Gera os casos de conferência a partir das regras exportadas da base oficial.
// Cobre: todas as classificações CBS/IBS em várias datas (inclui as bordas de vigência da base),
// sem código / NCM / NBS (aplicável, excetuado e não aplicável), bases com arredondamento,
// alíquotas nominais (2027+), tributação regular (suspensões) e Imposto Seletivo.
const fs = require("fs");
const R = JSON.parse(fs.readFileSync(process.argv[2])), N = JSON.parse(fs.readFileSync(process.argv[3]));
const vig = (ini, fim, d) => ini <= d && (fim == null || d <= fim);
const addDia = (s, k) => { const t = new Date(s.slice(0, 10) + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); };
let seed = 20261125; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; const pick = (a) => a[Math.floor(rnd() * a.length)];
const sit = new Map(R.sit.map((s) => [s[0], s]));
const cbsCl = (d) => R.cl.filter((c) => vig(c[6], c[7], d) && R.trst.some((t) => t[0] === c[4] && t[1] === 2 && vig(t[2], t[3], d)));
const isCl = (d) => R.cl.filter((c) => vig(c[6], c[7], d) && R.trst.some((t) => t[0] === c[4] && t[1] === 1 && vig(t[2], t[3], d)));
const cst = (c) => sit.get(c[4])[1];
const ncm8 = N.ncm.map((n) => n[0]), nbs9 = N.nbs.map((n) => n[0]);
const ncmCom = (pref) => ncm8.filter((n) => n.startsWith(pref)), nbsCom = (pref) => nbs9.filter((n) => n.startsWith(pref));
// datas: fixas + bordas de vigência encontradas na base (dia anterior, o próprio, dia seguinte)
const fixas = ["2025-12-31", "2026-01-01", "2026-02-01", "2026-02-02", "2026-07-15", "2026-12-31", "2027-01-01", "2027-07-15", "2028-12-31", "2029-01-01", "2033-12-31", "2034-01-01"];
const bordas = new Set();
for (const tab of ["cl", "tc", "red", "aadv", "aavp", "aarp", "ncma", "encm", "nbsa", "enbs", "ref", "trst"]) for (const r of R[tab]) for (const v of r) if (typeof v === "string" && /^20[23]\d-\d\d-\d\d/.test(v) && v.slice(0, 10) >= "2025-12-01" && v.slice(0, 10) <= "2034-01-31") bordas.add(v.slice(0, 10));
for (const n of R.ncmcod) for (const v of [n[1], n[2]]) if (v && v.slice(0, 10) >= "2025-12-01" && v.slice(0, 10) <= "2034-01-31") bordas.add(v.slice(0, 10));
const datasBorda = [...new Set([...bordas].flatMap((b) => [addDia(b, -1), b, addDia(b, 1)]))].filter((d) => !fixas.includes(d)).sort();
const BASES = ["1000", "0.5", "12.35", "333.33", "0", "1234567.89", "0.05", "99.99"];
const NOMINAIS = [{ cbs: 8.8, ibsEstadual: 17.7, ibsMunicipal: 0.5 }, { cbs: 0.0333, ibsEstadual: 1.2345, ibsMunicipal: 99.9999 }, { cbs: 0, ibsEstadual: 0.1, ibsMunicipal: 0 }];
const casos = [];
const add = (data, item, rotulo) => casos.push({ id: casos.length + 1, rotulo, data, item });
function variantesNomenclatura(c, d) {
  const v = [{}];
  const an = R.ncma.filter((a) => a[2] === c[0]), ex = R.encm.filter((e) => an.some((a) => a[0] === e[1]));
  if (an.length) { for (const a of [pick(an), pick(an)]) { const l = ncmCom(a[1]); if (l.length) v.push({ ncm: pick(l) }); } if (ex.length) { const l = ncmCom(pick(ex)[0]); if (l.length) v.push({ ncm: pick(l) }); } }
  v.push({ ncm: "09024000" }, { ncm: "24022000" });
  const bn = R.nbsa.filter((a) => a[2] === c[0]);
  if (bn.length) { for (const a of [pick(bn), pick(bn)]) { const l = nbsCom(a[1]); if (l.length) v.push({ nbs: pick(l) }); } }
  v.push({ nbs: "122011100" }, { nbs: pick(nbs9) });
  return v;
}
const regulares = (d) => { const l = cbsCl(d).filter((c) => { const t = R.tc.find((x) => x[0] === c[0] && vig(x[2], x[3], d)); const tt = t && R.tt.find((y) => y[0] === t[1]); return tt && !tt[9]; }); const porTrat = new Map(); for (const c of l) { const t = R.tc.find((x) => x[0] === c[0] && vig(x[2], x[3], d)); if (!porTrat.has(t[1])) porTrat.set(t[1], c); } return [...porTrat.values()]; };
function principal(d, completo) {
  const ano = Number(d.slice(0, 4));
  for (const c of cbsCl(d)) {
    const t = R.tc.find((x) => x[0] === c[0] && vig(x[2], x[3], d)); const tt = t && R.tt.find((y) => y[0] === t[1]);
    const noms = completo ? variantesNomenclatura(c, d) : [{}, ...variantesNomenclatura(c, d).slice(1, 3)];
    for (const nom of noms) {
      const bases = completo ? [pick(BASES), pick(BASES), "1000"] : ["1000"];
      for (const base of bases) {
        const item = Object.assign({ cst: cst(c), cClassTrib: c[1], baseCalculo: base }, nom);
        if (ano >= 2027) item.aliquotasNominais = pick(NOMINAIS);
        if (tt && tt[9]) for (const rg of regulares(d).slice(0, completo ? 6 : 2)) add(d, Object.assign({}, item, { tributacaoRegular: { cst: cst(rg), cClassTrib: rg[1] } }), "suspensao");
        else add(d, item, "principal");
      }
    }
    if (completo) {
      add(d, { cst: cst(c), cClassTrib: c[1], baseCalculo: "100" }, ano >= 2027 ? "sem-nominais" : "base");
      if (ano < 2027) add(d, { cst: cst(c), cClassTrib: c[1], baseCalculo: "100", aliquotasNominais: NOMINAIS[0] }, "nominais-indevidas");
      add(d, { cst: cst(c) === "000" ? "200" : "000", cClassTrib: c[1], baseCalculo: "100", ncm: "09024000", aliquotasNominais: ano >= 2027 ? NOMINAIS[0] : undefined }, "cst-trocado");
      if (tt && tt[9]) add(d, { cst: cst(c), cClassTrib: c[1], baseCalculo: "100", aliquotasNominais: ano >= 2027 ? NOMINAIS[0] : undefined }, "suspensao-sem-regular");
    }
  }
  add(d, { cst: "000", cClassTrib: "999999", baseCalculo: "100" }, "codigo-inexistente");
  add(d, { cst: "000", cClassTrib: "000001", baseCalculo: "100", ncm: "99999999" }, "ncm-inexistente");
  add(d, { cst: "000", cClassTrib: "000001", baseCalculo: "100", ncm: "09024000", nbs: "122011100" }, "ncm-e-nbs");
}
function seletivo(d, completo) {
  const ano = Number(d.slice(0, 4));
  const prefixos = [...new Set([...R.aavp.map((a) => a[1]), ...R.aarp.map((a) => a[1])])];
  const ncms = [...new Set(prefixos.flatMap((p) => { const l = ncmCom(p); return l.length ? [l[0], pick(l)] : []; }))];
  const clsIS = isCl(d);
  for (const ncm of completo ? ncms : ncms.slice(0, 12)) {
    const base = pick(["1000", "200", "37.77", "0.5"]);
    const nomBase = ano >= 2027 ? pick(NOMINAIS) : undefined;
    const grupo = (cl, extra) => Object.assign({ cst: cl ? cst(cl) : "000", cClassTrib: cl ? cl[1] : "000001", baseCalculo: base, quantidade: 10, unidade: "VN" }, extra || {});
    add(d, { cst: "000", cClassTrib: "000001", ncm, baseCalculo: base, quantidade: 10, unidade: "VN", aliquotasNominais: nomBase }, "is-sem-grupo");
    for (const cl of (completo ? clsIS : clsIS.slice(0, 2))) {
      for (const isn of [{ adValorem: 13, adRem: 2.13 }, { adValorem: 0.3333 }, { adRem: 1.5 }]) {
        const an = nomBase ? Object.assign({}, nomBase, { impostoSeletivo: isn }) : (ano >= 2027 ? { impostoSeletivo: isn } : undefined);
        add(d, { cst: "000", cClassTrib: "000001", ncm, baseCalculo: base, quantidade: 10, unidade: "VN", aliquotasNominais: an, impostoSeletivo: grupo(cl) }, "is");
      }
      if (completo) {
        const an = nomBase ? Object.assign({}, nomBase, { impostoSeletivo: { adValorem: 13, adRem: 2.13 } }) : undefined;
        add(d, { cst: "000", cClassTrib: "000001", ncm, baseCalculo: String(Number(base) + 5), aliquotasNominais: an, impostoSeletivo: grupo(cl, { impostoInformado: 5 }) }, "is-informado");
        add(d, { cst: "000", cClassTrib: "000001", ncm, baseCalculo: base, aliquotasNominais: an, impostoSeletivo: grupo(cl, { quantidade: 0 }) }, "is-qtd-zero");
        add(d, { cst: "000", cClassTrib: "000001", ncm, baseCalculo: base, aliquotasNominais: nomBase ? Object.assign({}, nomBase) : undefined, impostoSeletivo: grupo(cl) }, "is-sem-aliquota");
        add(d, { cst: "200", cClassTrib: "200032", ncm, baseCalculo: base, aliquotasNominais: an, impostoSeletivo: grupo(cl) }, "is-com-reducao");
      }
    }
  }
}
for (const d of fixas) { principal(d, true); seletivo(d, true); }
for (const d of datasBorda) { principal(d, false); seletivo(d, false); }
fs.writeFileSync(process.argv[4], JSON.stringify(casos));
console.log(`casos: ${casos.length} | datas fixas: ${fixas.length} | datas de borda: ${datasBorda.length}`);
