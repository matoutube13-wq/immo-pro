import Anthropic from "@anthropic-ai/sdk";
import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  HeadingLevel, BorderStyle, UnderlineType, LevelFormat,
  PageNumber, Footer, Header, TabStopType, TabStopPosition
} from "docx";

export const config = { api: { bodyParser: { sizeLimit: "20mb" } } };

// ─── Helpers ──────────────────────────────────────────────────────────────────
function bold(text) {
  return new TextRun({ text, bold: true });
}
function normal(text) {
  return new TextRun({ text });
}
function italic(text) {
  return new TextRun({ text, italics: true });
}
function underline(text) {
  return new TextRun({ text, underline: { type: UnderlineType.SINGLE } });
}
function boldUnderline(text) {
  return new TextRun({ text, bold: true, underline: { type: UnderlineType.SINGLE } });
}
function para(children, opts = {}) {
  return new Paragraph({ children: Array.isArray(children) ? children : [children], ...opts });
}
function heading1(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 28 })],
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000", space: 4 } }
  });
}
function heading2(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 24 })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 150 }
  });
}
function bullet(text) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    children: [normal(text)]
  });
}
function spacer() {
  return new Paragraph({ children: [normal("")], spacing: { after: 120 } });
}
function sectionTitle(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, bold: true, size: 28 })],
    spacing: { before: 600, after: 300 },
    border: {
      top: { style: BorderStyle.SINGLE, size: 4, color: "000000", space: 8 },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000", space: 8 }
    }
  });
}

// ─── Build DOCX ──────────────────────────────────────────────────────────────
function buildCompromis(data) {
  const {
    // Vendeur(s)
    vendeurs = [],
    // Acquéreur(s)
    acquereurs = [],
    // Bien
    adresseBien, commune, division, section, numero, contenance, inclus,
    // Prix
    prixLettres, prixChiffres, montantGarantie, ibanAcquereur, ibanAgence,
    // Conditions
    conditionSuspensiveFinancement,
    // Notaires
    notaireVendeur, notaireAcquereur,
    // Infos techniques
    revenuCadastral, peb_numero, peb_expert, peb_date, peb_classe,
    elec_date, elec_organisme, elec_conforme,
    citerne_type, citerne_present,
    zone_inondable,
    urbanisme_zone, urbanisme_permis, urbanisme_date_permis,
    sol_extrait, sol_date,
    // Date
    dateSignature, lieuSignature
  } = data;

  const children = [];

  // ── PAGE DE GARDE ──────────────────────────────────────────────────────────
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "TREVI RASQUAIN", bold: true, size: 36 })],
      spacing: { before: 400, after: 100 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "Agence n°1 en Région wallonne !", size: 24 })],
      spacing: { after: 600 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "COMPROMIS DE VENTE", bold: true, size: 52 })],
      spacing: { after: 100 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "D'UN BIEN IMMOBILIER", bold: true, size: 52 })],
      spacing: { after: 600 }
    }),
    spacer(), spacer(), spacer(),
    // Encadré résumé
    new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 4 }, bottom: { style: BorderStyle.SINGLE, size: 4 }, left: { style: BorderStyle.SINGLE, size: 4 }, right: { style: BorderStyle.SINGLE, size: 4 } },
      spacing: { before: 200, after: 100 },
      children: [
        bold("Les vendeurs : "),
        normal(vendeurs.map(v => `${v.nom} ${v.prenom}`).join(" – "))
      ]
    }),
    new Paragraph({
      border: { left: { style: BorderStyle.SINGLE, size: 4 }, right: { style: BorderStyle.SINGLE, size: 4 } },
      children: [
        bold("Les acquéreurs : "),
        normal(acquereurs.map(a => `${a.nom} ${a.prenom}`).join(" – "))
      ]
    }),
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 4 }, left: { style: BorderStyle.SINGLE, size: 4 }, right: { style: BorderStyle.SINGLE, size: 4 } },
      spacing: { after: 200 },
      children: [
        bold("Le bien vendu : "),
        normal(adresseBien)
      ]
    }),
    spacer(), spacer(),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [italic("Le vendeur vend à l'acquéreur, qui accepte, le bien immobilier")],
      spacing: { after: 60 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [italic("tel que décrit dans ce compromis aux conditions suivantes :")],
      spacing: { after: 400 }
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "! ", bold: true }),
        bold("Avant de signer, "),
        new TextRun({ text: "lisez attentivement", bold: true, underline: { type: UnderlineType.SINGLE } }),
        bold(" ce document. La signature d'un compromis de vente vous engage directement.")
      ],
      spacing: { after: 600 }
    })
  );

  // ── ÉLÉMENTS PRINCIPAUX ────────────────────────────────────────────────────
  children.push(sectionTitle("Éléments principaux de la vente"), spacer());

  // Art 1 - Vendeur & acquéreur
  children.push(heading1("1   Désignation du vendeur et de l'acquéreur"), spacer());
  children.push(para([bold("Les vendeurs sont :")]));
  children.push(spacer());
  for (const v of vendeurs) {
    children.push(
      para([
        italic(`${v.civilite} ${v.nom} ${v.prenom}`),
        normal(`, né${v.civilite === "Madame" ? "e" : ""} à ${v.lieuNaissance} le ${v.dateNaissance} ;`)
      ]),
      para([normal(`domicilié${v.civilite === "Madame" ? "e" : ""} à ${v.adresse}.`)]),
      para([normal(`Tel : ${v.telephone}`)]),
      para([normal(`Mail : ${v.email}`)]),
      spacer()
    );
  }
  children.push(para([italic("Dénommés ensemble ci-après « le vendeur ».")]), spacer());
  children.push(para([bold("L'acquéreur est :")]));
  children.push(spacer());
  for (const a of acquereurs) {
    children.push(
      para([
        italic(`${a.civilite} ${a.nom} ${a.prenom}`),
        normal(`, né${a.civilite === "Madame" ? "e" : ""} à ${a.lieuNaissance} le ${a.dateNaissance}, ${a.situationFamiliale}, domicilié${a.civilite === "Madame" ? "e" : ""} à ${a.adresse}.`)
      ]),
      para([normal(a.declarationCohabitation || "Déclarant ne pas avoir fait de déclaration de cohabitation légale.")]),
      para([normal(`Tel : ${a.telephone}`)]),
      para([normal(`Mail : ${a.email}`)]),
      spacer()
    );
  }
  children.push(
    para([italic("Dénommé ci-après « l'acquéreur ».")]),
    spacer(),
    para([italic("Le vendeur et l'acquéreur sont aussi appelés ci-dessous « signataires ».")]),
    spacer()
  );

  // Art 2 - Bien vendu
  children.push(heading1("2   Bien vendu"), spacer());
  children.push(para([bold("Le bien vendu :")]));
  children.push(spacer());
  children.push(para([italic(`${commune.toUpperCase()} / ${division}`)]));
  children.push(spacer());
  children.push(para([
    underline(adresseBien),
    normal(`, cadastrée selon extrait cadastral récent section ${section} numéro ${numero} pour une contenance totale de ${contenance}.`)
  ]));
  children.push(spacer());
  children.push(para([
    bold("Le vendeur déclare que sont compris dans la vente les"),
    normal(` : ${inclus || "immeubles par incorporation, la citerne d'eau de pluie, ainsi que toute réserve de combustible (mazout, gaz, …)"}.`)
  ]));
  children.push(spacer());
  children.push(para([
    normal("L'acquéreur déclare avoir visité le bien. Il ne demande pas au vendeur d'en faire une description plus précise et complète dans ce compromis."),
  ]));
  children.push(para([normal("Les indications cadastrales sont données comme simple renseignement.")]));
  children.push(spacer());

  // Art 3 - Prix
  children.push(heading1("3   Prix du bien"), spacer());
  children.push(para([
    normal("La vente est consentie et acceptée pour le prix de "),
    boldUnderline(`${prixLettres}, ${prixChiffres} EUR.`)
  ]));
  children.push(spacer());
  children.push(para([bold("Le paiement s'effectue comme suit :")]));
  children.push(bullet(`À la signature de ce compromis :\nL'acquéreur paie une somme de ${montantGarantie} EUR, par virement du compte numéro ${ibanAcquereur} au nom de l'agence Trevi Rasquain sur le compte numéro ${ibanAgence}.\nCette somme restera consignée au nom de l'acquéreur jusqu'à la signature de l'acte authentique de vente (ci-après « acte »), à titre de garantie (valant acompte le jour de la signature de l'acte).`));
  children.push(bullet("À la signature de l'acte :\nL'acquéreur paie le solde du prix. Il déclare que ce montant et les frais de l'acte seront payés par un crédit et/ou par des fonds provenant du compte repris ci-dessus."));
  children.push(spacer());

  // Art 4 - Frais
  children.push(heading1("4   Frais liés à la vente"), spacer());
  children.push(para([normal("À la signature de l'acte "), bold("l'acquéreur paie"), normal(" les frais suivants :")]));
  children.push(
    bullet("les droits d'enregistrement ;"),
    bullet("les débours ;"),
    bullet("le forfait légal :"),
    bullet("les honoraires ;"),
    bullet("la TVA sur les débours, le forfait légal et sur les honoraires.")
  );
  children.push(spacer());
  children.push(para([bold("Le vendeur paie :")]));
  children.push(
    bullet("les frais nécessaires pour mettre le bien en vente."),
    bullet("les frais nécessaires pour transférer et délivrer le bien.")
  );
  children.push(spacer());

  // Art 5 - Condition suspensive financement
  children.push(heading1("5   Condition suspensive d'un financement"), spacer());
  if (conditionSuspensiveFinancement === "non") {
    children.push(para([normal("Cette vente n'est pas conclue sous la condition suspensive d'obtenir un financement par l'acquéreur.")]));
  } else {
    children.push(para([normal(`Cette vente est conclue sous condition suspensive d'obtenir un financement : ${conditionSuspensiveFinancement}.`)]));
  }
  children.push(spacer());

  // Art 6 - Acte authentique
  children.push(heading1("6   Acte authentique de vente"), spacer());
  children.push(para([
    normal("L'acte sera signé "),
    underline("au plus tard dans les 4 mois de la signature du compromis de vente.")
  ]));
  children.push(spacer());
  children.push(para([normal("Les signataires doivent communiquer ce choix au plus tard dans les 8 jours calendrier de ce compromis.")]));
  children.push(
    bullet(`Le vendeur a choisi ${italic(notaireVendeur) ? notaireVendeur : "le notaire _______________"}.`),
    bullet(`L'acquéreur a choisi ${italic(notaireAcquereur) ? notaireAcquereur : "le notaire _______________"}.`)
  );
  children.push(spacer());

  // Art 7 - Déclarations
  children.push(heading1("7   Déclarations des signataires"), spacer());
  children.push(para([normal("Chacun des signataires déclare pour ce qui le concerne :")]));
  children.push(
    bullet("que son identité/comparution est conforme à ce qui est mentionné au point 1 ci-dessus ;"),
    bullet("ne pas être assisté ou représenté par un administrateur ;"),
    bullet("ne pas être dessaisi de l'administration de ses biens ;"),
    bullet("ne pas se trouver en faillite à ce jour ;"),
    bullet("ne pas avoir déposé de requête en réorganisation judiciaire ;"),
    bullet("ne pas avoir déposé de requête en règlement collectif de dettes et ne pas avoir l'intention de le faire ;"),
    bullet("s'engager personnellement et de manière solidaire avec les autres personnes s'engageant avec lui ;"),
    bullet("engager ses héritiers et ayants droit de manière indivisible aux obligations découlant de ce compromis.")
  );
  children.push(spacer());

  // ── CONDITIONS DE LA VENTE ─────────────────────────────────────────────────
  children.push(sectionTitle("Conditions de la vente"), spacer());

  children.push(heading1("8   Revenu cadastral"), spacer());
  children.push(para([normal(`Le revenu cadastral non indexé du bien est de ${revenuCadastral} EUR.`)]));
  children.push(spacer());

  children.push(heading1("9   Situation hypothécaire"), spacer());
  children.push(para([normal("Le vendeur s'engage à utiliser le prix de vente en priorité pour rembourser tous ses créanciers, afin que l'acquéreur achète le bien sans dette ni sûreté (gage, réserve de propriété ou hypothèque).")]));
  children.push(spacer());

  children.push(heading1("10  Propriété"), spacer());
  children.push(para([normal("L'acquéreur deviendra propriétaire du bien le jour de "), bold("la signature de l'acte.")]));
  children.push(spacer());

  children.push(heading1("11  Occupation – Jouissance"), spacer());
  children.push(para([normal("L'acquéreur aura la jouissance du bien par la prise de possession réelle du bien à la signature de l'acte.")]));
  children.push(spacer());

  children.push(heading1("12  Risques – Assurance"), spacer());
  children.push(para([normal("Le vendeur reste responsable des risques liés au bien jusqu'à la signature de l'acte.")]));
  children.push(spacer());

  children.push(heading1("13  Relevé des index"), spacer());
  children.push(para([normal("Lors de l'entrée en jouissance de l'acquéreur, les parties devront faire ensemble le relevé des index des compteurs (eau, électricité, gaz, etc.) afin de les transmettre aux sociétés de distribution.")]));
  children.push(spacer());

  children.push(heading1("14  Contributions – Taxes"), spacer());
  children.push(para([normal("Le vendeur reçoit l'avis de paiement du précompte immobilier pour l'année en cours et il paie la totalité.")]));
  children.push(spacer());

  children.push(heading1("15  État du bien"), spacer());
  children.push(para([normal("Le bien est et sera délivré dans son "), bold("état actuel."), normal(" L'acquéreur déclare qu'il connaît l'état du bien et qu'il a pu le visiter.")]));
  children.push(spacer());

  children.push(heading1("16  Servitudes – Mitoyennetés"), spacer());
  children.push(para([normal("Le bien est vendu avec toutes ses mitoyennetés et toutes ses servitudes.")]));
  children.push(spacer());

  children.push(heading1("17  Superficie"), spacer());
  children.push(para([normal("La superficie reprise dans la description du bien n'est pas garantie par le vendeur.")]));
  children.push(spacer());

  children.push(heading1("18  Panneaux/Enseignes"), spacer());
  children.push(para([normal("Le vendeur déclare qu'"), bold("aucun panneau publicitaire"), normal(" n'est apposé sur le bien et qu'il n'existe aucun contrat à ce sujet.")]));
  children.push(spacer());

  children.push(heading1("19  Sanctions en cas de non-respect des obligations"), spacer());
  children.push(para([bold("19.1 Exécution forcée ou résolution")]));
  children.push(para([normal("Si un des signataires ne respecte pas ses obligations, l'autre doit lui envoyer une mise en demeure dans laquelle il lui demande d'exécuter son obligation dans les 15 jours.")]));
  children.push(spacer());

  children.push(heading1("20  Élection de domicile"), spacer());
  children.push(para([normal("Pour l'exécution des engagements liés à ce compromis, jusqu'à la signature de l'acte, le vendeur et l'acquéreur élisent domicile en leur domicile ou siège mentionné au point 1.")]));
  children.push(spacer());

  children.push(heading1("21  Résolution des conflits"), spacer());
  children.push(para([normal("Si la validité, la formation, l'interprétation, la rupture et/ou l'exécution de ce compromis donnent lieu à un conflit, le vendeur et l'acquéreur sont informés de la possibilité de faire appel à un mode alternatif de résolution de conflits (conciliation, médiation ou arbitrage).")]));
  children.push(spacer());

  children.push(heading1("22  Agent immobilier"), spacer());
  children.push(para([normal("Cette vente a été négociée par l'intermédiaire de l'agence immobilière Trevi Rasquain (IPI :501.320) dont les honoraires seront pris en charge par le vendeur.")]));
  children.push(spacer());

  // ── INFORMATIONS ADMINISTRATIVES ───────────────────────────────────────────
  children.push(sectionTitle("Informations et obligations administratives"), spacer());

  children.push(heading1("23  Dossier d'intervention ultérieure (DIU)"), spacer());
  children.push(para([normal("Les signataires sont informés de l'obligation de constituer, conserver et compléter un DIU qui reprend notamment les éléments utiles en matière de sécurité et de santé à prendre en compte lors de l'exécution de travaux ultérieurs.")]));
  children.push(spacer());

  children.push(heading1("24  Contrôle de l'installation électrique"), spacer());
  children.push(para([normal(`Dans le procès-verbal du ${elec_date} (copie remise à l'acquéreur), l'organisme ${elec_organisme} a constaté que l'installation électrique est `), bold(elec_conforme === "conforme" ? "conforme" : "non conforme"), normal(".")]));
  children.push(spacer());

  children.push(heading1("25  Performance énergétique du bâtiment (PEB)"), spacer());
  children.push(para([
    normal(`Un certificat PEB portant le numéro ${peb_numero} a été établi par l'expert ${peb_expert}, le ${peb_date}. Il reprend le bien en classe énergétique `),
    bold(peb_classe), normal(".")
  ]));
  children.push(spacer());

  children.push(heading1("26  Informations sur la situation urbanistique"), spacer());
  children.push(para([normal(`Le bien est situé en zone ${urbanisme_zone}.`)]));
  if (urbanisme_permis) {
    children.push(para([normal(`Le bien a fait l'objet d'un permis d'urbanisme délivré le ${urbanisme_date_permis} pour ${urbanisme_permis}.`)]));
  }
  children.push(spacer());

  children.push(heading1("27  Équipement"), spacer());
  children.push(para([normal("Le vendeur déclare qu'à sa connaissance, le bien bénéficie d'une voirie équipée en eau, électricité.")]));
  children.push(spacer());

  children.push(heading1("28  Zones inondables"), spacer());
  children.push(para([normal(`Le vendeur déclare que le bien ${zone_inondable === "oui" ? "se trouve" : "ne se trouve pas"} dans une zone délimitée par la cartographie reprise sur le site Géoportail de la Wallonie comme présentant un risque d'inondation par débordement de cours d'eau ou ruissellement.`)]));
  children.push(spacer());

  children.push(heading1("29  Expropriation – Monuments/Sites – Alignement – Emprise"), spacer());
  children.push(para([normal("Le vendeur déclare que le bien n'est pas concerné par des mesures d'expropriation ou de protection prises en vertu de la législation sur les monuments et sites.")]));
  children.push(spacer());

  children.push(heading1("30  Code wallon de l'habitation durable"), spacer());
  children.push(para([normal("Le vendeur déclare que le bien n'est pas concerné par un permis de location.")]));
  children.push(spacer());

  children.push(heading1("31  Droit de préemption – Droit de préférence"), spacer());
  children.push(para([normal("La vente est faite sous la condition suspensive du non exercice des droits de préemption et de préférence.")]));
  children.push(spacer());

  children.push(heading1("32  Gestion et assainissement du sol"), spacer());
  children.push(para([normal(`Pour chaque parcelle vendue, l'extrait conforme de la Banque de Données de l'État des Sols, daté du ${sol_date}, énonce ce qui suit : Cette parcelle n'est pas soumise à des obligations au regard du décret sols.`)]));
  children.push(spacer());

  children.push(heading1("33  Gestion des ressources du sous-sol"), spacer());
  children.push(para([normal("Le vendeur s'engage à remettre la FISS à l'acquéreur au plus tard à l'acte authentique de vente.")]));
  children.push(spacer());

  children.push(heading1("34  CertIBEau"), spacer());
  children.push(para([normal("Le vendeur déclare que le bien a été raccordé à la distribution publique de l'eau avant le 1er juin 2021 et ne pas avoir demandé de CertIBEau.")]));
  children.push(spacer());

  children.push(heading1("35  Citerne à mazout/gaz"), spacer());
  if (citerne_present === "oui") {
    children.push(para([normal(`Le vendeur déclare qu'une citerne ${citerne_type || "gaz"} enterrée se trouve dans le bien.`)]));
    children.push(para([normal("Le vendeur déclare être propriétaire de la citerne.")]));
  } else {
    children.push(para([normal("Le vendeur déclare qu'il n'y a pas de citerne à mazout ou gaz dans le bien.")]));
  }
  children.push(spacer());

  children.push(heading1("36  Permis d'environnement"), spacer());
  children.push(para([normal("Le vendeur déclare que le bien n'est soumis à aucun permis d'environnement particulier.")]));
  children.push(spacer());

  children.push(heading1("37  Primes"), spacer());
  children.push(para([normal("Le vendeur déclare ne pas avoir bénéficié d'une ou de plusieurs primes (réhabilitation, achat, construction, démolition, restructuration, création d'un logement conventionné).")]));
  children.push(spacer());

  // ── FISCALITÉ ──────────────────────────────────────────────────────────────
  children.push(sectionTitle("Fiscalité"), spacer());

  children.push(heading1("38  Déclarations fiscales (enregistrement, TVA, plus-value, etc.)"), spacer());
  children.push(para([normal("Les signataires déclarent que la vente est entièrement réalisée sous le régime des droits d'enregistrement.")]));
  children.push(spacer());
  children.push(para([bold("38.3 Réduction")]));
  children.push(para([normal("L'acquéreur déclare avoir été informé des conditions d'obtention de la réduction des droits d'enregistrement.")]));
  children.push(spacer());

  // ── SIGNATURES ─────────────────────────────────────────────────────────────
  children.push(sectionTitle("Signatures"), spacer());

  children.push(para([bold("Le vendeur et l'acquéreur sont tenus d'exécuter leurs engagements de bonne foi.")], { alignment: AlignmentType.CENTER }));
  children.push(spacer());
  children.push(para([normal(`Fait en 3 originaux à l'agence immobilière Trevi Rasquain à ${lieuSignature || "Huy"}.`)]));
  children.push(para([normal(`Le ${dateSignature || "____ / ____ / ______"}.`)]));
  children.push(spacer(), spacer(), spacer());

  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: "Signature(s) acquéreur(s)", size: 22 }),
        new TextRun({ text: "\t\t\t\t", size: 22 }),
        new TextRun({ text: "Signature(s) vendeur(s)", size: 22 })
      ],
      tabStops: [{ type: TabStopType.LEFT, position: 5400 }]
    })
  );
  children.push(spacer(), spacer(), spacer(), spacer(), spacer());

  // ── ASSEMBLE DOCUMENT ─────────────────────────────────────────────────────
  const doc = new Document({
    numbering: {
      config: [{
        reference: "bullets",
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: "•",
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } }
        }]
      }]
    },
    styles: {
      default: { document: { run: { font: "Arial", size: 22 } } },
      paragraphStyles: [
        {
          id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 26, bold: true, font: "Arial", color: "000000" },
          paragraph: { spacing: { before: 300, after: 150 }, outlineLevel: 0 }
        },
        {
          id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 24, bold: true, font: "Arial", color: "000000" },
          paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 }
        }
      ]
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 }
        }
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({ text: "TREVI Rasquain – IPI 501.320 – info@trevirasquain.be – 085 25 39 03", size: 16, color: "888888" })
              ]
            })
          ]
        })
      },
      children
    }]
  });

  return doc;
}

// ─── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  try {
    const { files, formData } = req.body;

    // Si des fichiers sont fournis, les envoyer à Claude pour extraction
    let extractedData = {};
    if (files && files.length > 0) {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const fileContents = files.map(f => ({
        type: "document",
        source: { type: "base64", media_type: f.type, data: f.data }
      }));

      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4000,
        messages: [{
          role: "user",
          content: [
            ...fileContents,
            {
              type: "text",
              text: `Analyse ces documents immobiliers et extrais TOUTES les informations pour remplir un compromis de vente belge.
Réponds UNIQUEMENT avec un objet JSON valide contenant ces champs (null si non trouvé) :
{
  "adresseBien": "adresse complète du bien",
  "commune": "commune",
  "division": "division cadastrale",
  "section": "section cadastrale",
  "numero": "numéro parcelle",
  "contenance": "surface en ares/centiares",
  "revenuCadastral": "montant RC non indexé",
  "peb_numero": "numéro certificat PEB",
  "peb_expert": "nom expert PEB",
  "peb_date": "date certificat PEB",
  "peb_classe": "classe PEB (A/B/C/D/E/F/G)",
  "elec_date": "date contrôle électrique",
  "elec_organisme": "organisme contrôle électrique",
  "elec_conforme": "conforme ou non conforme",
  "citerne_present": "oui ou non",
  "citerne_type": "mazout ou gaz",
  "zone_inondable": "oui ou non",
  "urbanisme_zone": "zone urbanistique",
  "urbanisme_permis": "description permis",
  "urbanisme_date_permis": "date permis",
  "sol_date": "date extrait sol",
  "prixChiffres": "prix en chiffres",
  "prixLettres": "prix en lettres"
}`
            }
          ]
        }]
      });

      const raw = response.content[0]?.text || "{}";
      const clean = raw.replace(/```json|```/g, "").trim();
      try { extractedData = JSON.parse(clean); } catch { extractedData = {}; }
    }

    // Fusionner données extraites + formulaire (le formulaire a priorité)
    const data = { ...extractedData, ...formData };

    // Valeurs par défaut
    if (!data.vendeurs || !data.vendeurs.length) {
      data.vendeurs = [{ civilite: "Monsieur", nom: "___", prenom: "___", dateNaissance: "___", lieuNaissance: "___", adresse: "___", telephone: "___", email: "___" }];
    }
    if (!data.acquereurs || !data.acquereurs.length) {
      data.acquereurs = [{ civilite: "Monsieur", nom: "___", prenom: "___", dateNaissance: "___", lieuNaissance: "___", adresse: "___", situationFamiliale: "célibataire", telephone: "___", email: "___" }];
    }

    // Générer le .docx
    const doc = buildCompromis(data);
    const buffer = await Packer.toBuffer(doc);

    const nomFichier = `Compromis_${(data.commune || "Bien").replace(/\s/g, "_")}_${new Date().toISOString().slice(0, 10)}.docx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${nomFichier}"`);
    res.setHeader("Content-Length", buffer.length);
    return res.status(200).send(buffer);

  } catch (err) {
    console.error("Compromis error:", err);
    return res.status(500).json({ error: err.message });
  }
}
