/**
 * Every language's words, translated from the English in the code by the
 * model Kithena's assistant uses, with each string's context.
 *
 * Reads `src/locales/source/<ns>.json` (`i18n-extract.mjs`) and fills
 * `src/locales/<language>/<ns>.json` with what is missing or whose English
 * changed since it was translated (`src/locales/lock.json` keeps a hash of the
 * English each translation was made from). Strings go in batches, each with
 * where it sits on the screen, a glossary for the language and the rules a
 * native UX writer would follow: a translation of words in a place, not a
 * word-for-word one. A translation that drops or invents a `{{placeholder}}`
 * is refused and asked for again; one that still fails stays English.
 *
 *   ASSISTANT_API_KEY=… node apps/web/scripts/i18n-translate.mjs [--minutes 300] [--only de,fr] [--ns recruiting]
 *
 * `ASSISTANT_BASE_URL` and `ASSISTANT_MODEL` as the services read them
 * (Groq's `openai/gpt-oss-120b` by default). Stops at `--minutes` and keeps
 * what it has, so a long first run can be finished by running it again.
 *
 * A plural message (`key_one`, `key_other` in the source) is translated into
 * the forms each language has (`Intl.PluralRules`): Polish and Russian get
 * `key_few` and `key_many` from the English `other`, with examples of the
 * numbers each form is for.
 *
 * Too much for the model's quota at once, the same work goes by hand:
 *
 *   node apps/web/scripts/i18n-translate.mjs --export pending.json
 *   node apps/web/scripts/i18n-translate.mjs --import done.json
 *
 * `--export` writes what needs translating, with its context, and stops;
 * `--import` takes `{ "<language>": { "<ns>": { "<key>": "…" } } }` and keeps
 * what passes the placeholder check, as an answer from the model would be.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = join(WEB, 'src/locales');
const SOURCE = join(LOCALES, 'source');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const MINUTES = Number(arg('minutes') ?? '300');
const EXPORT = arg('export');
const IMPORT = arg('import');
const ONLY = arg('only')?.split(',');
const ONLY_NS = arg('ns')?.split(',');
const BATCH = 50;
const PARALLEL = Number(process.env.I18N_PARALLEL ?? '6');
const BASE = (process.env.ASSISTANT_BASE_URL ?? 'https://api.groq.com/openai/v1').replace(
  /\/$/u,
  '',
);
const MODEL = process.env.ASSISTANT_MODEL ?? 'openai/gpt-oss-120b';
const KEY = process.env.ASSISTANT_API_KEY ?? '';
const DEADLINE = Date.now() + MINUTES * 60_000;

/* ------------------------------------------------------------ languages -- */

/** How each language is written: its name for the model, its register, its glossary. */
const LANGUAGES = {
  'en-US': {
    name: 'American English (en-US)',
    register:
      'Rewrite into American English: American spelling (organization, color, canceled, center, license, catalog, judgment) and American workplace vocabulary (résumé for CV, vacation or time off for holiday when it means leave, ZIP code for postcode, last name for surname). Keep everything else exactly as it is; most strings need no change at all and come back identical.',
    glossary: {},
  },
  'en-GB': {
    name: 'British English (en-GB)',
    register:
      'Make sure it reads as British English: British spelling (organisation, colour, cancelled, centre, licence as a noun) and usage (CV, holiday for paid leave, surname). Keep everything else exactly as it is; most strings need no change at all and come back identical.',
    glossary: {},
  },
  de: {
    name: 'German (de-DE)',
    register:
      'Address the reader formally with "Sie". Buttons and menu items use the infinitive ("Speichern", "Entwurf löschen"). German quotation marks „…“. Prefer established German HR terms; avoid needless anglicisms, but keep ones German HR software uses (Recruiting, Onboarding, Feedback).',
    glossary: {
      People: 'Personal',
      'Time Off': 'Abwesenheiten',
      Recruiting: 'Recruiting',
      Onboarding: 'Onboarding',
      Documents: 'Dokumente',
      Performance: 'Performance',
      Inbox: 'Posteingang',
      Settings: 'Einstellungen',
      employee: 'Mitarbeitende/r (Mitarbeiter:in where space is short)',
      manager: 'Führungskraft',
      'direct report': 'direkt unterstellte Person',
      'legal entity': 'Gesellschaft',
      department: 'Abteilung',
      location: 'Standort',
      leave: 'Abwesenheit / Urlaub',
      'leave request': 'Abwesenheitsantrag',
      allowance: 'Anspruch',
      balance: 'Saldo',
      'public holiday': 'Feiertag',
      'sick leave': 'Krankheit',
      overtime: 'Überstunden',
      timesheet: 'Zeiterfassung',
      'clock in': 'Einstempeln',
      'clock out': 'Ausstempeln',
      approval: 'Genehmigung',
      approver: 'Genehmigende Person',
      'works council': 'Betriebsrat',
      'pay band': 'Gehaltsband',
      grade: 'Gehaltsstufe',
      payslip: 'Gehaltsabrechnung',
      contract: 'Vertrag',
      probation: 'Probezeit',
      'notice period': 'Kündigungsfrist',
      candidate: 'Bewerber:in',
      job: 'Stelle',
      requisition: 'Stellenanforderung',
      offer: 'Angebot',
      pipeline: 'Pipeline',
      stage: 'Phase',
      scorecard: 'Scorecard',
      interview: 'Vorstellungsgespräch',
      'hiring manager': 'Einstellende Führungskraft',
      recruiter: 'Recruiter:in',
      'talent pool': 'Talentpool',
      'review cycle': 'Beurteilungsrunde',
      review: 'Beurteilung',
      goal: 'Ziel',
      'check-in': 'Check-in',
      template: 'Vorlage',
      policy: 'Richtlinie',
      envelope: 'Umschlag',
      'e-signature': 'E-Signatur',
      'Dark mode': 'Dunkelmodus',
    },
  },
  fr: {
    name: 'French (fr-FR)',
    register:
      'Address the reader with "vous". Buttons and menu items use the infinitive ("Enregistrer", "Supprimer le brouillon"). French typography: a space before : ; ! ? and « » quotation marks. Use the vocabulary of French HR software.',
    glossary: {
      People: 'Collaborateurs',
      'Time Off': 'Absences',
      Recruiting: 'Recrutement',
      Onboarding: 'Intégration',
      Documents: 'Documents',
      Performance: 'Performance',
      Inbox: 'Boîte de réception',
      Settings: 'Paramètres',
      employee: 'collaborateur',
      manager: 'manager',
      'direct report': 'collaborateur direct',
      'legal entity': 'entité juridique',
      department: 'service',
      location: 'site',
      leave: 'congé / absence',
      'leave request': 'demande d’absence',
      allowance: 'droits',
      balance: 'solde',
      'public holiday': 'jour férié',
      'sick leave': 'arrêt maladie',
      overtime: 'heures supplémentaires',
      timesheet: 'feuille de temps',
      'clock in': 'pointer l’arrivée',
      'clock out': 'pointer le départ',
      approval: 'validation',
      approver: 'valideur',
      'works council': 'CSE',
      'pay band': 'fourchette de salaire',
      grade: 'niveau',
      payslip: 'bulletin de paie',
      contract: 'contrat',
      probation: 'période d’essai',
      'notice period': 'préavis',
      candidate: 'candidat',
      job: 'poste',
      requisition: 'demande de recrutement',
      offer: 'offre',
      pipeline: 'pipeline',
      stage: 'étape',
      scorecard: 'grille d’évaluation',
      interview: 'entretien',
      'hiring manager': 'manager recruteur',
      recruiter: 'recruteur',
      'talent pool': 'vivier de talents',
      'review cycle': 'campagne d’évaluation',
      review: 'évaluation',
      goal: 'objectif',
      'check-in': 'point d’étape',
      template: 'modèle',
      policy: 'politique',
      envelope: 'enveloppe',
      'e-signature': 'signature électronique',
      'Dark mode': 'Mode sombre',
    },
  },
  es: {
    name: 'Spanish as written in Spain (es-ES)',
    register:
      'Address the reader with "tú", as modern Spanish workplace software does. Buttons and menu items use the infinitive ("Guardar", "Eliminar borrador"). Spanish punctuation (¿…? ¡…!).',
    glossary: {
      People: 'Personas',
      'Time Off': 'Ausencias',
      Recruiting: 'Selección',
      Onboarding: 'Incorporación',
      Documents: 'Documentos',
      Performance: 'Desempeño',
      Inbox: 'Bandeja de entrada',
      Settings: 'Ajustes',
      employee: 'empleado',
      manager: 'responsable',
      'direct report': 'colaborador directo',
      'legal entity': 'entidad legal',
      department: 'departamento',
      location: 'centro de trabajo',
      leave: 'ausencia / vacaciones',
      'leave request': 'solicitud de ausencia',
      allowance: 'derecho',
      balance: 'saldo',
      'public holiday': 'festivo',
      'sick leave': 'baja por enfermedad',
      overtime: 'horas extra',
      timesheet: 'registro de jornada',
      'clock in': 'fichar entrada',
      'clock out': 'fichar salida',
      approval: 'aprobación',
      approver: 'aprobador',
      'works council': 'comité de empresa',
      'pay band': 'banda salarial',
      grade: 'nivel',
      payslip: 'nómina',
      contract: 'contrato',
      probation: 'periodo de prueba',
      'notice period': 'preaviso',
      candidate: 'candidato',
      job: 'puesto',
      requisition: 'solicitud de vacante',
      offer: 'oferta',
      pipeline: 'proceso',
      stage: 'fase',
      scorecard: 'ficha de evaluación',
      interview: 'entrevista',
      'hiring manager': 'responsable de contratación',
      recruiter: 'reclutador',
      'talent pool': 'cantera de talento',
      'review cycle': 'ciclo de evaluación',
      review: 'evaluación',
      goal: 'objetivo',
      'check-in': 'seguimiento',
      template: 'plantilla',
      policy: 'política',
      envelope: 'sobre',
      'e-signature': 'firma electrónica',
      'Dark mode': 'Modo oscuro',
    },
  },
  it: {
    name: 'Italian (it-IT)',
    register:
      'Use a friendly professional tone; address the reader with "tu" only where a sentence needs a subject, otherwise prefer impersonal phrasing. Buttons and menu items use the infinitive ("Salva" is acceptable as the usual imperative for buttons).',
    glossary: {
      People: 'Persone',
      'Time Off': 'Assenze',
      Recruiting: 'Selezione',
      Onboarding: 'Onboarding',
      Documents: 'Documenti',
      Performance: 'Performance',
      Inbox: 'Posta in arrivo',
      Settings: 'Impostazioni',
      employee: 'dipendente',
      manager: 'responsabile',
      'direct report': 'collaboratore diretto',
      'legal entity': 'entità legale',
      department: 'reparto',
      location: 'sede',
      leave: 'assenza / ferie',
      'leave request': 'richiesta di assenza',
      allowance: 'spettanza',
      balance: 'saldo',
      'public holiday': 'festività',
      'sick leave': 'malattia',
      overtime: 'straordinari',
      timesheet: 'foglio presenze',
      'clock in': 'timbrare l’entrata',
      'clock out': 'timbrare l’uscita',
      approval: 'approvazione',
      approver: 'approvatore',
      'works council': 'rappresentanza sindacale',
      'pay band': 'fascia retributiva',
      grade: 'livello',
      payslip: 'busta paga',
      contract: 'contratto',
      probation: 'periodo di prova',
      'notice period': 'preavviso',
      candidate: 'candidato',
      job: 'posizione',
      requisition: 'richiesta di assunzione',
      offer: 'offerta',
      pipeline: 'pipeline',
      stage: 'fase',
      scorecard: 'scheda di valutazione',
      interview: 'colloquio',
      'hiring manager': 'responsabile dell’assunzione',
      recruiter: 'recruiter',
      'talent pool': 'bacino di talenti',
      'review cycle': 'ciclo di valutazione',
      review: 'valutazione',
      goal: 'obiettivo',
      'check-in': 'check-in',
      template: 'modello',
      policy: 'policy',
      envelope: 'busta',
      'e-signature': 'firma elettronica',
      'Dark mode': 'Modalità scura',
    },
  },
  ca: {
    name: 'Catalan (ca-ES)',
    register:
      'Standard Central Catalan. Address the reader with "tu" where a subject is needed, otherwise prefer impersonal phrasing. Buttons and menu items use the infinitive ("Desa" as the usual imperative is also acceptable; be consistent within a batch).',
    glossary: {
      People: 'Persones',
      'Time Off': 'Absències',
      Recruiting: 'Selecció',
      Onboarding: 'Incorporació',
      Documents: 'Documents',
      Performance: 'Acompliment',
      Inbox: 'Safata d’entrada',
      Settings: 'Configuració',
      employee: 'empleat',
      manager: 'responsable',
      'legal entity': 'entitat jurídica',
      department: 'departament',
      location: 'centre de treball',
      leave: 'absència / vacances',
      'leave request': 'sol·licitud d’absència',
      balance: 'saldo',
      'public holiday': 'festiu',
      'sick leave': 'baixa per malaltia',
      overtime: 'hores extres',
      'clock in': 'fitxar l’entrada',
      'clock out': 'fitxar la sortida',
      approval: 'aprovació',
      'works council': 'comitè d’empresa',
      'pay band': 'banda salarial',
      payslip: 'nòmina',
      contract: 'contracte',
      probation: 'període de prova',
      candidate: 'candidat',
      job: 'lloc de treball',
      offer: 'oferta',
      stage: 'fase',
      interview: 'entrevista',
      'hiring manager': 'responsable de contractació',
      review: 'avaluació',
      goal: 'objectiu',
      template: 'plantilla',
      policy: 'política',
      'e-signature': 'signatura electrònica',
      'Dark mode': 'Mode fosc',
    },
  },
  nl: {
    name: 'Dutch (nl-NL)',
    register:
      'Address the reader with "je/jij", as Dutch workplace software does. Buttons and menu items use the infinitive ("Opslaan", "Concept verwijderen").',
    glossary: {
      People: 'Medewerkers',
      'Time Off': 'Verlof',
      Recruiting: 'Werving',
      Onboarding: 'Onboarding',
      Documents: 'Documenten',
      Performance: 'Prestaties',
      Inbox: 'Inbox',
      Settings: 'Instellingen',
      employee: 'medewerker',
      manager: 'leidinggevende',
      'legal entity': 'juridische entiteit',
      department: 'afdeling',
      location: 'vestiging',
      leave: 'verlof',
      'leave request': 'verlofaanvraag',
      allowance: 'tegoed',
      balance: 'saldo',
      'public holiday': 'feestdag',
      'sick leave': 'ziekteverlof',
      overtime: 'overuren',
      timesheet: 'urenregistratie',
      'clock in': 'inklokken',
      'clock out': 'uitklokken',
      approval: 'goedkeuring',
      approver: 'goedkeurder',
      'works council': 'ondernemingsraad',
      'pay band': 'salarisschaal',
      payslip: 'loonstrook',
      contract: 'contract',
      probation: 'proeftijd',
      'notice period': 'opzegtermijn',
      candidate: 'kandidaat',
      job: 'vacature',
      requisition: 'personeelsaanvraag',
      offer: 'aanbod',
      stage: 'fase',
      interview: 'sollicitatiegesprek',
      'hiring manager': 'hiring manager',
      'talent pool': 'talentpool',
      'review cycle': 'beoordelingscyclus',
      review: 'beoordeling',
      goal: 'doel',
      template: 'sjabloon',
      policy: 'beleid',
      'e-signature': 'e-handtekening',
      'Dark mode': 'Donkere modus',
    },
  },
  pt: {
    name: 'European Portuguese (pt-PT, as written in Portugal — never Brazilian)',
    register:
      'Neutral formal register: avoid "tu" and "você"; use impersonal phrasing or the infinitive. Buttons and menu items use the infinitive ("Guardar", "Eliminar rascunho"). European Portuguese vocabulary and spelling (equipa, ficheiro, utilizador, registo).',
    glossary: {
      People: 'Pessoas',
      'Time Off': 'Ausências',
      Recruiting: 'Recrutamento',
      Onboarding: 'Integração',
      Documents: 'Documentos',
      Performance: 'Desempenho',
      Inbox: 'Caixa de entrada',
      Settings: 'Definições',
      employee: 'colaborador',
      manager: 'chefia',
      'legal entity': 'entidade jurídica',
      department: 'departamento',
      location: 'local de trabalho',
      leave: 'ausência / férias',
      'leave request': 'pedido de ausência',
      balance: 'saldo',
      'public holiday': 'feriado',
      'sick leave': 'baixa médica',
      overtime: 'horas extraordinárias',
      'clock in': 'registar entrada',
      'clock out': 'registar saída',
      approval: 'aprovação',
      'works council': 'comissão de trabalhadores',
      'pay band': 'banda salarial',
      payslip: 'recibo de vencimento',
      contract: 'contrato',
      probation: 'período experimental',
      'notice period': 'pré-aviso',
      candidate: 'candidato',
      job: 'vaga',
      offer: 'proposta',
      stage: 'fase',
      interview: 'entrevista',
      'hiring manager': 'responsável pela contratação',
      team: 'equipa',
      file: 'ficheiro',
      user: 'utilizador',
      review: 'avaliação',
      goal: 'objetivo',
      template: 'modelo',
      policy: 'política',
      'e-signature': 'assinatura eletrónica',
      'Dark mode': 'Modo escuro',
    },
  },
  pl: {
    name: 'Polish (pl-PL)',
    register:
      'Neutral formal register; avoid addressing the reader directly where an impersonal form works. Buttons and menu items use the infinitive ("Zapisz" as the established imperative for buttons is fine). Use correct Polish plural and case forms around placeholders; Polish quotation marks „…”.',
    glossary: {
      People: 'Pracownicy',
      'Time Off': 'Nieobecności',
      Recruiting: 'Rekrutacja',
      Onboarding: 'Wdrożenie',
      Documents: 'Dokumenty',
      Performance: 'Ocena pracy',
      Inbox: 'Skrzynka odbiorcza',
      Settings: 'Ustawienia',
      employee: 'pracownik',
      manager: 'przełożony',
      'legal entity': 'podmiot prawny',
      department: 'dział',
      location: 'lokalizacja',
      leave: 'urlop / nieobecność',
      'leave request': 'wniosek urlopowy',
      balance: 'saldo',
      'public holiday': 'święto',
      'sick leave': 'zwolnienie lekarskie',
      overtime: 'nadgodziny',
      'clock in': 'rozpoczęcie pracy',
      'clock out': 'zakończenie pracy',
      approval: 'akceptacja',
      'works council': 'rada pracowników',
      'pay band': 'widełki płacowe',
      payslip: 'pasek wynagrodzenia',
      contract: 'umowa',
      probation: 'okres próbny',
      'notice period': 'okres wypowiedzenia',
      candidate: 'kandydat',
      job: 'stanowisko',
      offer: 'oferta',
      stage: 'etap',
      interview: 'rozmowa kwalifikacyjna',
      'hiring manager': 'menedżer zatrudniający',
      review: 'ocena',
      goal: 'cel',
      template: 'szablon',
      policy: 'zasady',
      'e-signature': 'podpis elektroniczny',
      'Dark mode': 'Tryb ciemny',
    },
  },
  ru: {
    name: 'Russian (ru-RU)',
    register:
      'Neutral formal register (address the reader with "Вы" only where needed). Buttons and menu items use the infinitive ("Сохранить", "Удалить черновик"). Use correct Russian plural and case forms around placeholders; Russian quotation marks «…».',
    glossary: {
      People: 'Сотрудники',
      'Time Off': 'Отсутствия',
      Recruiting: 'Подбор',
      Onboarding: 'Адаптация',
      Documents: 'Документы',
      Performance: 'Эффективность',
      Inbox: 'Входящие',
      Settings: 'Настройки',
      employee: 'сотрудник',
      manager: 'руководитель',
      'legal entity': 'юридическое лицо',
      department: 'отдел',
      location: 'офис',
      leave: 'отпуск / отсутствие',
      'leave request': 'заявка на отсутствие',
      balance: 'остаток',
      'public holiday': 'праздничный день',
      'sick leave': 'больничный',
      overtime: 'сверхурочные',
      'clock in': 'отметить приход',
      'clock out': 'отметить уход',
      approval: 'согласование',
      'works council': 'совет трудового коллектива',
      'pay band': 'вилка зарплаты',
      payslip: 'расчётный листок',
      contract: 'договор',
      probation: 'испытательный срок',
      'notice period': 'срок предупреждения',
      candidate: 'кандидат',
      job: 'вакансия',
      offer: 'оффер',
      stage: 'этап',
      interview: 'собеседование',
      'hiring manager': 'нанимающий менеджер',
      review: 'оценка',
      goal: 'цель',
      template: 'шаблон',
      policy: 'политика',
      'e-signature': 'электронная подпись',
      'Dark mode': 'Тёмная тема',
    },
  },
  hi: {
    name: 'Hindi (hi-IN)',
    register:
      'Formal, polite register: address the reader as "आप". Write the Hindi an Indian HR team reads at work every day: clear Devanagari, with the English loanwords Indian offices use as such written in Devanagari (ईमेल, डैशबोर्ड, लिंक) rather than Sanskritised coinages. Buttons and menu items are short imperatives ("सहेजें", "हटाएँ"). Keep numbers as digits.',
    glossary: {
      People: 'कर्मचारी',
      'Time Off': 'छुट्टी',
      Recruiting: 'भर्ती',
      Onboarding: 'ऑनबोर्डिंग',
      Documents: 'दस्तावेज़',
      Performance: 'प्रदर्शन',
      Inbox: 'इनबॉक्स',
      Settings: 'सेटिंग्स',
      employee: 'कर्मचारी',
      manager: 'मैनेजर',
      'leave request': 'छुट्टी का अनुरोध',
      approve: 'मंज़ूर करें',
      decline: 'अस्वीकार करें',
      candidate: 'उम्मीदवार',
      job: 'नौकरी',
      offer: 'ऑफ़र',
      interview: 'इंटरव्यू',
      review: 'समीक्षा',
      goal: 'लक्ष्य',
      policy: 'नीति',
      'e-signature': 'ई-हस्ताक्षर',
    },
  },
  ta: {
    name: 'Tamil (ta-IN)',
    register:
      'Formal, polite register: address the reader as "நீங்கள்". Write the Tamil an HR team in Tamil Nadu reads at work: clear modern Tamil, with English loanwords common in offices (ஈமெயில், லிங்க்) used where a pure-Tamil coinage would read as stiff. Buttons and menu items are short polite imperatives ("சேமிக்கவும்", "நீக்கவும்"). Keep numbers as digits.',
    glossary: {
      People: 'பணியாளர்கள்',
      'Time Off': 'விடுப்பு',
      Recruiting: 'பணியமர்த்தல்',
      Onboarding: 'பணியில் சேர்த்தல்',
      Documents: 'ஆவணங்கள்',
      Performance: 'செயல்திறன்',
      Inbox: 'இன்பாக்ஸ்',
      Settings: 'அமைப்புகள்',
      employee: 'பணியாளர்',
      manager: 'மேலாளர்',
      'leave request': 'விடுப்பு கோரிக்கை',
      approve: 'அங்கீகரிக்கவும்',
      decline: 'நிராகரிக்கவும்',
      candidate: 'வேட்பாளர்',
      job: 'வேலை',
      offer: 'வேலை வாய்ப்பு',
      interview: 'நேர்காணல்',
      review: 'மதிப்பாய்வு',
      goal: 'இலக்கு',
      policy: 'கொள்கை',
      'e-signature': 'மின்-கையொப்பம்',
    },
  },
};

const instruction = (
  lang,
) => `You are a senior UX writer and translator for Kithena, an HR software product used by companies in Europe and the US: employee records (People), leave and time tracking (Time Off), Recruiting, Onboarding, Documents with e-signatures, and Performance reviews. Translate interface strings from English into ${lang.name}.

How to translate:
1. Translate the meaning in its context, the way a native UX writer would write the interface — never word for word. Each string comes with its context: the area of the product, the screen (file and component) and what it is on screen (a button, a field's label, a dialog title, an aria-label for a screen reader, a description, a fragment built in code). Buttons and menu items are short actions; labels are short noun phrases; descriptions and messages are natural sentences.
2. Keep every {{placeholder}} exactly as written — same name, same double braces — and put it where the grammar of the language needs it. Never translate, rename, drop or add a placeholder. A placeholder may hold a name, a number, a date or another phrase.
3. Some strings are fragments that code joins with others (", one cycle per week", "the pay", "and a web search"). Translate them as fragments that read naturally in the same place, keeping leading or trailing punctuation and spaces as they are.
4. Keep product, brand and technical names as they are: Kithena, Slack, Microsoft Teams, Microsoft 365, Google, Google Meet, Google Calendar, Zoom, LinkedIn, Indeed, Okta, Entra, DATEV, SAP, Workday, CSV, PDF, XML, URL, API, AI, ID, SSO, SCIM. Keep keyboard keys (Enter, Esc, Shift, ⌘, Ctrl), symbols (·, →, …, ×) and units.
5. A string that is an example value, a code, an address or a placeholder hint (an email address, a URL, a slug) comes back unchanged.
6. Register and style: ${lang.register}
7. Use these terms consistently: ${JSON.stringify(lang.glossary)}
8. Keep the length close to the English where you can: these are interface strings in buttons, menus and table headers.

You get a JSON object {"strings": [{"id": "…", "en": "…", "context": "…"}]}. Answer with only a JSON object mapping each id to its translation: {"<id>": "<translation>"}. Every id must be answered.`;

/* ---------------------------------------------------------------- files -- */

const readJson = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  const sorted = Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(`${path}.tmp`, `${JSON.stringify(sorted, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
};
const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);
const placeholders = (text) =>
  [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/gu)]
    .map((m) => m[1])
    .sort()
    .join(',');

const namespaces = readdirSync(SOURCE)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -5))
  .filter((ns) => ONLY_NS === undefined || ONLY_NS.includes(ns));
const sources = Object.fromEntries(
  namespaces.map((ns) => [ns, readJson(join(SOURCE, `${ns}.json`), {})]),
);
const lockPath = join(LOCALES, 'lock.json');

/** Numbers that take a form in a language, for the context: `few` in Polish is 2, 3, 4, 22… */
function examplesOf(language, form) {
  const rules = new Intl.PluralRules(language);
  const found = [];
  for (const n of [0, 1, 2, 3, 4, 5, 11, 12, 21, 22, 25, 101, 1.5, 1_000_000])
    if (rules.select(n) === form && found.length < 5) found.push(n);
  return found.join(', ');
}

/**
 * A namespace's source as one language translates it: each plural message
 * as the forms that language has, each with the English it comes from.
 */
function sourceFor(language, ns) {
  const source = sources[ns];
  const out = {};
  const forms = new Intl.PluralRules(language).resolvedOptions().pluralCategories;
  for (const [key, entry] of Object.entries(source)) {
    const base = key.endsWith('_other') ? key.slice(0, -'_other'.length) : null;
    const plural = base !== null && source[`${base}_one`] !== undefined;
    if (key.endsWith('_one') && source[`${key.slice(0, -4)}_other`] !== undefined) continue;
    if (!plural) {
      out[key] = entry;
      continue;
    }
    const one = source[`${base}_one`];
    for (const form of forms)
      out[`${base}_${form}`] = {
        text: form === 'one' ? one.text : entry.text,
        context: `${entry.context.replace(/ Plural: .*$/u, '')} Plural: the "${form}" form in ${language}, for a {{count}} such as ${examplesOf(language, form)}. English has "${one.text}" for one and "${entry.text}" otherwise.`,
      };
  }
  return out;
}
const lock = readJson(lockPath, {});

/* ---------------------------------------------------------------- model -- */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ask(lang, items) {
  const body = {
    model: MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    ...(MODEL.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
    messages: [
      { role: 'system', content: instruction(lang) },
      { role: 'user', content: JSON.stringify({ strings: items }) },
    ],
  };
  for (let attempt = 0; attempt < 6; attempt++) {
    if (Date.now() > DEADLINE) return null;
    let response;
    try {
      response = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
    } catch {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      const after = Number(response.headers.get('retry-after') ?? '0');
      await sleep(Math.max(after * 1000, 2000 * 2 ** attempt));
      continue;
    }
    if (!response.ok) {
      console.error(
        `the model refused: ${String(response.status)} ${(await response.text()).slice(0, 300)}`,
      );
      return null;
    }
    const data = await response.json();
    try {
      return JSON.parse(data.choices?.[0]?.message?.content ?? '');
    } catch {
      await sleep(1000);
    }
  }
  return null;
}

/** Translations of these items that keep their placeholders; the rest are left out. */
async function translate(lang, items) {
  const answer = await ask(
    lang,
    items.map(({ id, en, context }) => ({ id, en, context })),
  );
  const done = {};
  if (answer === null || typeof answer !== 'object') return done;
  for (const item of items) {
    const text = answer[item.id];
    if (typeof text !== 'string' || text.trim() === '') continue;
    if (placeholders(text) !== placeholders(item.en)) continue;
    done[item.id] = text;
  }
  return done;
}

/* ------------------------------------------------------------------ run -- */

const targets = Object.keys(LANGUAGES).filter((l) => ONLY === undefined || ONLY.includes(l));
if (KEY === '' && EXPORT === undefined && IMPORT === undefined) {
  console.error('ASSISTANT_API_KEY is not set: nothing translated.');
  process.exit(1);
}

let translated = 0;
let failed = 0;
const jobs = [];
const files = new Map();
for (const language of targets) {
  lock[language] ??= {};
  for (const ns of namespaces) {
    const path = join(LOCALES, language, `${ns}.json`);
    const held = readJson(path, {});
    const source = sourceFor(language, ns);
    // What the code no longer says goes.
    for (const key of Object.keys(held)) if (source[key] === undefined) delete held[key];
    for (const key of Object.keys(lock[language]))
      if (key.startsWith(`${ns}:`) && source[key.slice(ns.length + 1)] === undefined)
        delete lock[language][key];
    files.set(path, held);
    // The lock says what is done: a key it holds with no entry here reads the
    // same as the English, so the file never repeats the source.
    const todo = Object.entries(source)
      .filter(([key, { text }]) => lock[language][`${ns}:${key}`] !== hash(text))
      .map(([key, { text, context }]) => ({ key, en: text, context }));
    for (let i = 0; i < todo.length; i += BATCH)
      jobs.push({ language, ns, path, items: todo.slice(i, i + BATCH) });
  }
}
console.log(
  `${String(jobs.reduce((n, j) => n + j.items.length, 0))} strings to translate in ${String(jobs.length)} batches`,
);

const save = () => {
  for (const [path, held] of files)
    if (Object.keys(held).length > 0) writeJson(path, held);
    else rmSync(path, { force: true });
  writeJson(lockPath, lock);
};

if (EXPORT !== undefined) {
  writeJson(
    EXPORT,
    Object.fromEntries(
      jobs
        .flatMap((j) => j.items.map((item) => ({ ...item, language: j.language, ns: j.ns })))
        .map((item, i) => [String(i).padStart(6, '0'), item]),
    ),
  );
  console.log(`written to ${EXPORT}; nothing translated`);
  process.exit(0);
}

if (IMPORT !== undefined) {
  const given = readJson(IMPORT, {});
  for (const job of jobs) {
    const held = files.get(job.path);
    for (const item of job.items) {
      const text = given[job.language]?.[job.ns]?.[item.key];
      if (typeof text !== 'string' || text.trim() === '') continue;
      if (placeholders(text) !== placeholders(item.en)) {
        console.error(`placeholders differ: ${job.language} ${job.ns}:${item.key}`);
        failed++;
        continue;
      }
      if (text === item.en) delete held[item.key];
      else held[item.key] = text;
      lock[job.language][`${job.ns}:${item.key}`] = hash(item.en);
      translated++;
    }
  }
  jobs.length = 0;
}

let next = 0;
let sinceSave = 0;
async function worker() {
  while (next < jobs.length && Date.now() < DEADLINE) {
    const job = jobs[next++];
    const lang = LANGUAGES[job.language];
    const items = job.items.map((item, i) => ({ ...item, id: String(i + 1) }));
    let done = await translate(lang, items);
    // What came back wrong is asked for again, a few at a time.
    const missing = items.filter((item) => done[item.id] === undefined);
    for (let i = 0; i < missing.length && Date.now() < DEADLINE; i += 8)
      done = { ...done, ...(await translate(lang, missing.slice(i, i + 8))) };
    const held = files.get(job.path);
    for (const item of items) {
      const text = done[item.id];
      if (text === undefined) {
        failed++;
        continue;
      }
      if (text === item.en) delete held[item.key];
      else held[item.key] = text;
      lock[job.language][`${job.ns}:${item.key}`] = hash(item.en);
      translated++;
    }
    if (++sinceSave >= 20) {
      sinceSave = 0;
      save();
      console.log(
        `${String(translated)} translated, ${String(failed)} left in English, ${String(jobs.length - next)} batches to go`,
      );
    }
  }
}
await Promise.all(Array.from({ length: PARALLEL }, worker));
save();

/* ------------------------------------------------------------ catalogue -- */

const present = [];
let all = '';
for (const language of Object.keys(LANGUAGES))
  for (const ns of readdirSync(SOURCE).map((f) => f.slice(0, -5))) {
    const path = join(LOCALES, language, `${ns}.json`);
    if (!existsSync(path)) continue;
    present.push([language, ns]);
    all += readFileSync(path, 'utf8');
  }
const byLanguage = {};
for (const [language, ns] of present) (byLanguage[language] ??= []).push(ns);
const index = `// Generated by \`pnpm --filter @kithena/web i18n:translate\`. Do not edit.

type Loader = () => Promise<{ readonly default: Readonly<Record<string, string>> }>;

/** Changes whenever a translation does, so a browser's stored copy is never stale. */
export const VERSION = '${hash(all)}';

/** Each language's words, by namespace, loaded only when a page needs them. */
export const CATALOGUE: Readonly<Record<string, Readonly<Record<string, Loader>>>> = {
${Object.entries(byLanguage)
  .map(
    ([language, list]) =>
      `  ${/^[a-z]+$/u.test(language) ? language : `'${language}'`}: {\n${list.map((ns) => `    ${ns}: () => import('./${language}/${ns}.json'),`).join('\n')}\n  },`,
  )
  .join('\n')}
};
`;
writeFileSync(join(LOCALES, 'index.ts'), index);
console.log(
  `done: ${String(translated)} translated, ${String(failed)} left in English${next < jobs.length ? `, ${String(jobs.length - next)} batches not reached (run again)` : ''}`,
);
