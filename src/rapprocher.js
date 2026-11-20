// Rapprochement dû / payé : fenêtres de semaines, écarts par catégorie, constats.
// Aucune connaissance d'un pays : les noms de catégories viennent du jeu de règles.
import { arrondiDemiSup, montantCents, versCents, versDollars } from './argent.js';
import { catalogue, categorieFerie } from './regles_pur.js';
import { ajouterJours, enHeures } from './temps.js';

const somme = (obj) => Object.values(obj).reduce((t, n) => t + n, 0);

function minutesTemps(lignes, cat) {
  return Object.entries(lignes)
    .filter(([c]) => cat[c]?.type === 'temps')
    .reduce((t, [, l]) => t + l.minutes, 0);
}

function centsHorsAssiette(lignes, exclus) {
  return Object.entries(lignes)
    .filter(([c]) => !exclus.includes(c))
    .reduce((t, [, l]) => t + l.cents, 0);
}

/** Résumé d'une semaine : totaux dus / payés et assiette du super. */
function resumerSemaine(s) {
  const exclus = s.regles.super?.assiette_exclut ?? [];
  const totalDu = somme(Object.fromEntries(Object.entries(s.du).map(([c, l]) => [c, l.cents])));
  const totalPaye = somme(Object.fromEntries(Object.entries(s.paye).map(([c, l]) => [c, l.cents])));
  return {
    semaine: s.semaine,
    fiche: s.fiche?.fichier_source ?? null,
    du: Object.fromEntries(
      Object.entries(s.du).map(([c, l]) => [c, { heures: enHeures(l.minutes), montant: versDollars(l.cents) }]),
    ),
    paye: Object.fromEntries(
      Object.entries(s.paye).map(([c, l]) => [c, { heures: enHeures(l.minutes), montant: versDollars(l.cents) }]),
    ),
    total_du_cents: totalDu,
    total_paye_cents: totalPaye,
    ecart_cents: totalDu - totalPaye,
    ote_du_cents: centsHorsAssiette(s.du, exclus),
    ote_paye_cents: centsHorsAssiette(s.paye, exclus),
    super_pct: s.regles.super?.pct ?? null,
  };
}

/** Découpe en fenêtres : une semaine, ou deux si paiement décalé détecté. */
function fenetres(semaines, params, constats) {
  const { part_payee_max_pct: partMax, tolerance_excedent_pct: tol } = params.fusion_paiement_decale;
  const res = [];
  for (let i = 0; i < semaines.length; i++) {
    const a = semaines[i];
    if (!a.fiche) continue;
    const b = semaines[i + 1];
    if (b && b.fiche && ajouterJours(a.semaine, 7) === b.semaine) {
      const catA = catalogue(a.regles);
      const catB = catalogue(b.regles);
      const duA = minutesTemps(a.du, catA);
      const payeA = minutesTemps(a.paye, catA);
      const deficit = duA - payeA;
      const excedent = minutesTemps(b.paye, catB) - minutesTemps(b.du, catB);
      if (
        duA > 0 &&
        payeA * 100 < partMax * duA &&
        excedent > 0 &&
        Math.abs(excedent - deficit) * 100 <= tol * deficit
      ) {
        constats.push({
          type: 'paiement_decale',
          semaine: a.semaine,
          paye_avec: b.semaine,
          semaines: [a.semaine, b.semaine],
          heures_deficit: enHeures(deficit),
          heures_excedent: enHeures(excedent),
          heures: null,
          montant: null,
        });
        res.push([a, b]);
        i++;
        continue;
      }
    }
    res.push([a]);
  }
  return res;
}

function analyserFenetre(sems, constats) {
  const regles = sems[0].regles;
  const cat = catalogue(regles);
  const ids = sems.map((s) => s.semaine);
  const services = sems.flatMap((s) => s.services);
  const du = {};
  const paye = {};
  for (const s of sems) {
    for (const [c, l] of Object.entries(s.du)) du[c] = (du[c] ?? 0) + l.minutes;
    for (const [c, l] of Object.entries(s.paye)) paye[c] = (paye[c] ?? 0) + l.minutes;
  }
  const cats = [...new Set([...Object.keys(du), ...Object.keys(paye)])];
  for (const c of cats) {
    if (!cat[c]) throw new Error(`Catégorie « ${c} » absente du jeu de règles`);
  }
  const diff = Object.fromEntries(cats.map((c) => [c, (du[c] ?? 0) - (paye[c] ?? 0)]));
  const taux = (c) => cat[c].tauxCents;

  // Requalification : heures fériées payées au taux de la catégorie de repli.
  const catF = categorieFerie(regles);
  if (catF && (diff[catF] ?? 0) > 0) {
    const parRepli = {};
    const dates = {};
    for (const s of services) {
      const r = s.repli[catF];
      const m = s.segments[catF] ?? 0;
      if (r && m) {
        parRepli[r] = (parRepli[r] ?? 0) + m;
        (dates[r] ??= []).push(s.date);
      }
    }
    for (const [r, m] of Object.entries(parRepli)) {
      const h = Math.min(diff[catF], m);
      const surpaye = -(diff[r] ?? 0);
      if (h > 0 && surpaye >= h) {
        constats.push({
          type: `${catF}_paye_taux_ordinaire`,
          categorie: catF,
          categorie_repli: r,
          semaines: ids,
          dates: dates[r],
          date: dates[r].length === 1 ? dates[r][0] : null,
          heures: enHeures(h),
          montant: versDollars(montantCents(h, taux(catF) - taux(r))),
          detail: {
            du: versDollars(montantCents(h, taux(catF))),
            paye_au_taux_repli: versDollars(montantCents(h, taux(r))),
          },
        });
        diff[catF] -= h;
        diff[r] = (diff[r] ?? 0) + h;
      }
    }
  }

  // Écarts par catégorie, avec attribution à un jour pour les primes.
  for (const c of cats) {
    let reste = diff[c];
    const nommes = new Set();
    if (cat[c].type === 'prime') {
      const payeC = paye[c] ?? 0;
      for (const s of services) {
        const m = s.segments[c] ?? 0;
        if (m > payeC) {
          nommes.add(s);
          reste -= m;
          constats.push({
            type: `${c}_non_payee`,
            categorie: c,
            semaines: ids,
            date: s.date,
            heures: enHeures(m),
            montant: versDollars(montantCents(m, taux(c))),
          });
        }
      }
    }
    if (reste !== 0) {
      const jours = services.filter((s) => !nommes.has(s) && (s.segments[c] ?? 0) > 0);
      constats.push({
        type: 'ecart_heures',
        categorie: c,
        semaines: ids,
        date: jours.length === 1 ? jours[0].date : null,
        heures: enHeures(reste),
        montant: versDollars(montantCents(reste, taux(c))),
      });
    }
  }

  // Super sur l'écart de gains ordinaires.
  const resumes = sems.map(resumerSemaine);
  const dOte = resumes.reduce((t, r) => t + r.ote_du_cents - r.ote_paye_cents, 0);
  if (regles.super && dOte !== 0) {
    constats.push({
      type: 'ecart_super',
      semaines: ids,
      heures: null,
      montant: versDollars(arrondiDemiSup(dOte * regles.super.pct, 100)),
    });
  }

  return {
    semaines: ids,
    categories: Object.fromEntries(
      cats.map((c) => [
        c,
        {
          heures_dues: enHeures(du[c] ?? 0),
          heures_payees: enHeures(paye[c] ?? 0),
          ecart_minutes: diff[c],
          ecart_heures: enHeures(diff[c]),
          taux_cents: taux(c),
          ecart_montant_au_taux: versDollars(montantCents(diff[c], taux(c))),
        },
      ]),
    ),
    ecart_lignes: versDollars(resumes.reduce((t, r) => t + r.ecart_cents, 0)),
  };
}

function controlerFiche(s, { profil, params, correspondance }, constats) {
  const f = s.fiche;
  const regles = s.regles;
  const cat = catalogue(regles);
  // Retenues.
  const fiscales = regles.retenues?.categories_fiscales ?? [];
  for (const r of f.retenues ?? []) {
    if (r.montant === null) continue; // ligne sans montant : rien n'est retenu (totaux contrôlés à la lecture)
    if (fiscales.includes(correspondance[r.description])) continue;
    if ((profil.retenues_autorisees ?? []).includes(r.description)) continue;
    constats.push({
      type: r.montant >= 0 ? 'retenue_non_autorisee' : 'remboursement_retenue',
      libelle: r.description,
      semaine: s.semaine,
      semaines: [s.semaine],
      heures: null,
      montant: r.montant,
      reference: regles.retenues?.reference ?? null,
    });
  }
  // Brut = somme des lignes.
  const sommeLignes = f.lignes.reduce((t, l) => t + versCents(l.montant), 0);
  if (Math.abs(sommeLignes - versCents(f.brut)) > (params.tolerance_brut_cents ?? 0)) {
    constats.push({
      type: 'brut_incoherent',
      semaine: s.semaine,
      semaines: [s.semaine],
      heures: null,
      montant: versDollars(versCents(f.brut) - sommeLignes),
    });
  }
  // Taux affiché vs taux des règles.
  for (const l of f.lignes) {
    const c = correspondance[l.description];
    if (cat[c] && versCents(l.taux) !== cat[c].tauxCents) {
      constats.push({
        type: 'taux_different',
        categorie: c,
        libelle: l.description,
        semaine: s.semaine,
        semaines: [s.semaine],
        taux_fiche: l.taux,
        taux_regles: versDollars(cat[c].tauxCents),
        heures: null,
        montant: null,
      });
    }
  }
  // Super versé vs pourcentage du brut ordinaire payé.
  if (regles.super && f.super) {
    const r = resumerSemaine(s);
    const attendu = arrondiDemiSup(r.ote_paye_cents * regles.super.pct, 100);
    const verse = versCents(f.super.montant);
    if (Math.abs(verse - attendu) > (params.tolerance_super_cents ?? 0)) {
      constats.push({
        type: 'super_incoherent',
        semaine: s.semaine,
        semaines: [s.semaine],
        heures: null,
        montant: versDollars(attendu - verse),
      });
    }
  }
}

/**
 * semaines : [{ semaine, regles, services, du, paye, fiche }] triées.
 * Retourne { semaines, fenetres, constats }.
 */
export function rapprocher(semaines, contexte) {
  const constats = [];
  for (const s of semaines) {
    if (!s.fiche && s.services.length) {
      constats.push({ type: 'periode_sans_fiche', semaine: s.semaine, semaines: [s.semaine], heures: null, montant: null });
    }
    if (s.fiche && !s.services.length) {
      constats.push({ type: 'fiche_sans_heures', semaine: s.semaine, semaines: [s.semaine], heures: null, montant: null });
    }
    if (s.fiche) controlerFiche(s, contexte, constats);
  }
  const fen = fenetres(semaines, contexte.params, constats).map((w) => analyserFenetre(w, constats));
  return { semaines: semaines.map(resumerSemaine), fenetres: fen, constats };
}

const dans = (semaine, du, au) => semaine >= du && semaine <= au;

/** Totaux dû / payé / écart / super sur les semaines (avec fiche) entre du et au. */
export function totaux(rapport, du, au) {
  const sel = rapport.semaines.filter((s) => s.fiche && dans(s.semaine, du, au));
  const t = (k) => sel.reduce((a, s) => a + s[k], 0);
  const dOte = t('ote_du_cents') - t('ote_paye_cents');
  const pct = sel[0]?.super_pct;
  return {
    du: versDollars(t('total_du_cents')),
    paye: versDollars(t('total_paye_cents')),
    ecart: versDollars(t('ecart_cents')),
    ecart_ote: versDollars(dOte),
    ecart_super: pct == null ? null : versDollars(arrondiDemiSup(dOte * pct, 100)),
  };
}

/** Cumul des écarts (après requalification) par catégorie, sur les fenêtres entièrement entre du et au. */
export function cumulParCategorie(rapport, du, au) {
  const res = {};
  for (const w of rapport.fenetres) {
    if (!w.semaines.every((s) => dans(s, du, au))) continue;
    for (const [c, v] of Object.entries(w.categories)) {
      res[c] ??= { minutes: 0, taux_cents: v.taux_cents };
      res[c].minutes += v.ecart_minutes;
    }
  }
  return Object.fromEntries(
    Object.entries(res).map(([c, v]) => [
      c,
      { heures: enHeures(v.minutes), montant: versDollars(montantCents(v.minutes, v.taux_cents)) },
    ]),
  );
}
