// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, target states, the "Test the connection" report,
// scene outputs and errors. Four languages, the four of the Gladys interface;
// German says "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './smokeping/client.js';

/**
 * A failed action: Gladys shows in red what a handler throws, in green what
 * it returns. The message is the multi-language object.
 */
export class ActionFailure extends Error {
  constructor(text) {
    super(text.en);
    this.message = text;
  }
}

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your SmokePing in the configuration.',
    fr: "Saisissez l'adresse de votre SmokePing dans la configuration.",
    de: 'Gib die Adresse deines SmokePing in der Konfiguration ein.',
    es: 'Introduzca la dirección de su SmokePing en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.2/smokeping/',
    fr: 'Adresse incomprise, ex. http://192.168.1.2/smokeping/',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.2/smokeping/',
    es: 'Dirección no válida, p. ej. http://192.168.1.2/smokeping/',
  },
};

// One short explanation per error kind (src/smokeping/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'SmokePing does not answer',
    fr: 'SmokePing ne répond pas',
    de: 'SmokePing antwortet nicht',
    es: 'SmokePing no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: use an http:// address or a trusted certificate',
    fr: 'certificat refusé : utilisez une adresse http:// ou un certificat reconnu',
    de: 'Zertifikat abgelehnt: Nutze eine http://-Adresse oder ein vertrauenswürdiges Zertifikat',
    es: 'certificado rechazado: use una dirección http:// o un certificado reconocido',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'SmokePing asks for a login: check the user and password',
    fr: "SmokePing demande une connexion : vérifiez l'utilisateur et le mot de passe",
    de: 'SmokePing verlangt eine Anmeldung: Prüfe Benutzer und Passwort',
    es: 'SmokePing pide iniciar sesión: compruebe el usuario y la contraseña',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the full address of smokeping.cgi',
    fr: "l'adresse redirige : saisissez l'adresse complète de smokeping.cgi",
    de: 'die Adresse leitet um: Gib die vollständige Adresse von smokeping.cgi ein',
    es: 'la dirección redirige: introduzca la dirección completa de smokeping.cgi',
  },
  [ERROR_KINDS.NOT_SMOKEPING]: {
    en: 'no SmokePing interface at this address',
    fr: 'aucune interface SmokePing à cette adresse',
    de: 'keine SmokePing-Oberfläche unter dieser Adresse',
    es: 'no hay ninguna interfaz de SmokePing en esta dirección',
  },
  [ERROR_KINDS.NO_DATA]: {
    en: 'the RRD files are not served at the data address: see the setup guide',
    fr: "les fichiers RRD ne sont pas servis à l'adresse des données : voir le guide",
    de: 'die RRD-Dateien werden unter der Datenadresse nicht bereitgestellt: siehe Anleitung',
    es: 'los archivos RRD no se sirven en la dirección de datos: consulte la guía',
  },
  [ERROR_KINDS.RRD_FORMAT]: {
    en: 'RRD file not understood, see the logs',
    fr: 'fichier RRD incompris, voir les logs',
    de: 'RRD-Datei nicht verstanden, sieh in den Protokollen nach',
    es: 'archivo RRD no comprendido, consulte los registros',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The state of a target, in words (widget rows, scene outputs).
export const STATE_TEXT = {
  up: { en: 'Reachable', fr: 'Joignable', de: 'Erreichbar', es: 'Accesible' },
  down: { en: 'Unreachable', fr: 'Injoignable', de: 'Nicht erreichbar', es: 'Inaccesible' },
  unknown: {
    en: 'No measurement yet',
    fr: 'Aucune mesure',
    de: 'Noch keine Messung',
    es: 'Sin medición',
  },
  stale: {
    en: 'No recent measurement',
    fr: 'Aucune mesure récente',
    de: 'Keine aktuelle Messung',
    es: 'Sin medición reciente',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'Connected',
    targets: (count) => `${count} target(s)`,
    down: (count) => `${count} unreachable`,
    step: (seconds) => `a measurement every ${seconds} s`,
  },
  fr: {
    ok: 'Connecté',
    targets: (count) => `${count} cible(s)`,
    down: (count) => `${count} injoignable(s)`,
    step: (seconds) => `une mesure toutes les ${seconds} s`,
  },
  de: {
    ok: 'Verbunden',
    targets: (count) => `${count} Ziel(e)`,
    down: (count) => `${count} nicht erreichbar`,
    step: (seconds) => `eine Messung alle ${seconds} s`,
  },
  es: {
    ok: 'Conectado',
    targets: (count) => `${count} objetivo(s)`,
    down: (count) => `${count} inaccesible(s)`,
    step: (seconds) => `una medición cada ${seconds} s`,
  },
};

// Errors of the actions (shown in Gladys).
export const ACTION_TEXT = {
  unknownTarget: {
    en: 'This device is not a SmokePing target.',
    fr: "Cet appareil n'est pas une cible SmokePing.",
    de: 'Dieses Gerät ist kein SmokePing-Ziel.',
    es: 'Este dispositivo no es un objetivo de SmokePing.',
  },
  noTarget: {
    en: 'SmokePing answers, but no target has an RRD file at the data address: see the setup guide.',
    fr: "SmokePing répond, mais aucune cible n'a de fichier RRD à l'adresse des données : voir le guide.",
    de: 'SmokePing antwortet, aber kein Ziel hat eine RRD-Datei unter der Datenadresse: siehe Anleitung.',
    es: 'SmokePing responde, pero ningún objetivo tiene archivo RRD en la dirección de datos: consulte la guía.',
  },
  noGraph: {
    en: 'The SmokePing graph could not be read.',
    fr: 'Le graphique de SmokePing est illisible.',
    de: 'Die SmokePing-Grafik konnte nicht gelesen werden.',
    es: 'No se pudo leer el gráfico de SmokePing.',
  },
};

// The `sentence` output of "State of a target".
export const SENTENCE_TEXT = {
  en: { loss: (value) => `${value} % loss`, jitter: (value) => `jitter ${value} ms` },
  fr: { loss: (value) => `${value} % de pertes`, jitter: (value) => `gigue ${value} ms` },
  de: { loss: (value) => `${value} % Verlust`, jitter: (value) => `Jitter ${value} ms` },
  es: { loss: (value) => `${value} % de pérdidas`, jitter: (value) => `jitter ${value} ms` },
};

export const LANGUAGE_FALLBACK = 'en';

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

/** A number in the conventions of the language (decimal comma in fr, de, es). */
export const formatNumber = (value, language, digits = 1) =>
  new Intl.NumberFormat(LOCALES[language] ?? LOCALES.en, {
    maximumFractionDigits: digits,
  }).format(value);

/** A date and time in the conventions of the language, in the time zone of Gladys (TZ). */
export const formatDateTime = (time, language) =>
  new Intl.DateTimeFormat(LOCALES[language] ?? LOCALES.en, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(time));

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
