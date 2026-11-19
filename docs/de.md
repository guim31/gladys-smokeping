# SmokePing

[SmokePing](https://oss.oetiker.ch/smokeping/) misst die Latenz und den
Paketverlust deiner Verbindung zu ausgewählten Zielen und zeichnet seine
bekannten „Rauch“-Grafiken. Diese Integration bringt seine Ziele nach Gladys:
Jedes Ziel wird ein Gerät mit Median-Latenz, Paketverlust, Jitter und Grafik,
Szenen reagieren, wenn ein Ziel unerreichbar oder gestört ist, und ein
Dashboard-Widget zeigt sie alle.

Gladys liest SmokePing: Es pingt deine Ziele nicht selbst. Alles bleibt in
deinem Netzwerk (keine Cloud).

Getestet mit einem echten SmokePing in Docker (SmokePing 2.9.0, Image
`lscr.io/linuxserver/smokeping`): erreichbare, unerreichbare Ziele und
absichtlich erzeugter Paketverlust. Rückmeldungen sind willkommen in
[den Issues](https://github.com/guim31/gladys-smokeping/issues).

## Was du brauchst

- Gladys Assistant 5.1.0 oder neuer.
- SmokePing 2.7 oder neuer, seine Weboberfläche von Gladys aus erreichbar.
- Eine Zeile in der Konfiguration seines Webservers, damit Gladys die
  Messungen lesen kann (siehe unten). SmokePing hat keine API: Seine Zahlen
  stehen nur in seinen RRD-Dateien.

## Erste Schritte

### 1. Die RRD-Dateien bereitstellen

SmokePing speichert eine RRD-Datei pro Ziel in seinem Ordner `data`. Stelle
diesen Ordner schreibgeschützt unter `/smokeping-data/` auf demselben
Webserver bereit.

**Docker-Image `lscr.io/linuxserver/smokeping`**: Lege die Datei
`site-confs/gladys.conf` im auf `/config` eingehängten Ordner an und starte
den Container neu:

```apache
Alias /smokeping-data /data
<Directory "/data">
    Options -Indexes
    Require all granted
</Directory>
```

**Debian- oder Ubuntu-Paket (Apache)**: dieselben Zeilen mit
`/var/lib/smokeping` statt `/data`, in
`/etc/apache2/conf-available/smokeping-data.conf`, dann
`a2enconf smokeping-data` und Apache neu laden.

**Nginx**: `location /smokeping-data/ { alias /var/lib/smokeping/; }`.

Prüfe es: `http://<dein SmokePing>/smokeping-data/<Gruppe>/<Ziel>.rrd` muss
eine Datei herunterladen. Diese Dateien enthalten dieselben Zahlen wie die
SmokePing-Seite; schränke sie bei Bedarf wie diese ein
(`Require ip 192.168.1.0/24`, eine Anmeldung).

### 2. Die Integration konfigurieren

Öffne in Gladys die Integration und fülle aus:

- **SmokePing-Adresse**: die Adresse seiner Webseite, zum Beispiel
  `http://192.168.1.2/smokeping/`, oder seines `smokeping.cgi`
  (`http://192.168.1.2/cgi-bin/smokeping.cgi` beim Debian-Paket).
- **Adresse der RRD-Dateien**: leer lassen, wenn du Schritt 1 gefolgt bist.
- **Benutzer** und **Passwort**: nur wenn der Webserver eine Anmeldung
  verlangt. Die Zugangsdaten gehen nie an eine Adresse der RRD-Dateien auf
  einem anderen Server.
- **Schwelle für Paketverlust** (standardmäßig 10 %) und **Latenzschwelle**
  (100 ms): darüber gilt ein Ziel als gestört.
- **Messungen in Folge**: wie viele SmokePing-Messungen in Folge über einer
  Schwelle oder ganz ohne Antwort bis zum Alarm (standardmäßig 2). SmokePing
  misst standardmäßig alle 5 Minuten: 2 bedeutet 10 Minuten.
- **Aktualisierungsintervall**: 1 bis 5 Minuten (standardmäßig 1 Minute).
  Jedes Mal ein paar kleine Anfragen pro Ziel.
- **Zeitraum der Grafik**: 3 Stunden, 30 Stunden oder 10 Tage.
- **Sprache der Namen**: Sprache der Funktionsnamen und der Szenen-Ergebnisse
  (standardmäßig Französisch).

Klicke dann auf **Verbindung testen**: SmokePing wird gelesen und die Ziele
werden gezählt.

### 3. Die Ziele hinzufügen

Öffne den Tab **Entdecken** der Integration: ein Gerät pro SmokePing-Ziel,
benannt wie in seinem Menü (die Gruppen sind keine Geräte). Füge die Ziele
hinzu, die du verfolgen willst. Die Szenen-Auslöser und das Widget
funktionieren für alle Ziele, hinzugefügt oder nicht.

## Die Geräte

Jedes Ziel:

- **Erreichbar**: ja, wenn bei der letzten Messung mindestens ein Ping
  geantwortet hat, nein nach der gewählten Zahl von Messungen ganz ohne
  Antwort.
- **Median-Latenz**: die mittlere Umlaufzeit (Median), in Millisekunden.
- **Paketverlust**: der Anteil verlorener Pings, in Prozent.
- **Jitter**: die Standardabweichung der Umlaufzeiten, in Millisekunden.
- **Letzte Messung**: wann SmokePing zuletzt gemessen hat, in der Zeitzone
  von Gladys.
- **SmokePing-Grafik**: die SmokePing-Grafik des Ziels als Kamerabild, alle
  5 Minuten und auf Anfrage aktualisiert.

Die Messungen werden höchstens alle 5 Minuten gesendet, sofort bei einer
Zustandsänderung. Ein Ziel, das SmokePing nicht mehr misst, zeigt das Abzeichen
„nicht erreichbar“ und sendet nichts.

## Dashboard

Das Widget **SmokePing** zeigt drei Kacheln (unerreichbare Ziele, gestörte,
Median-Latenz) und eine Zeile pro Ziel, die unerreichbaren und gestörten
zuerst, mit Latenz und Verlust. In seinen Einstellungen wählst du eine Gruppe
oder in Gladys angelegte Ziele und blendest die Kacheln oder die Schaltfläche
**Aktualisieren** aus. Die Schaltfläche **Aktualisieren** liest SmokePing
sofort.

Das Dashboard-Widget **Kamera** zeigt die Grafik eines Ziels.

## Szenen

### Auslöser

- **Ein Ziel wird unerreichbar**: Alle Pings zu einem Ziel gehen verloren, so
  viele Messungen in Folge wie eingestellt. Variablen: Name des Ziels,
  Gruppe.
- **Ein Ziel ist wieder erreichbar**: Ein unerreichbares Ziel antwortet
  wieder. Variablen: Name des Ziels, Gruppe, Dauer des Ausfalls in Minuten.
- **Paketverlust über der Schwelle**: Der Verlust eines erreichbaren Ziels
  erreicht die Schwelle, Messungen in Folge. Variablen: Name des Ziels,
  Gruppe, Paketverlust.
- **Latenz über der Schwelle**: Die Median-Latenz erreicht die Schwelle,
  Messungen in Folge. Variablen: Name des Ziels, Gruppe, Median-Latenz.

Alle lassen sich auf bestimmte Ziele beschränken. Beim ersten Lesen wird kein
Ereignis gesendet: nur echte Änderungen. Ein Alarm kommt erst wieder, nachdem
der Wert unter die Schwelle zurückgekehrt ist. Ein Ziel, das während eines
Neustarts von Gladys unerreichbar wurde, wird trotzdem gemeldet, einmal.

### Aktionen

- **Zustand eines Ziels**: erreichbar oder nicht, Zustand in Worten,
  Median-Latenz, Verlust, Jitter und ein fertiger Satz wie „Box: Erreichbar,
  23,4 ms, 12 % Verlust, Jitter 3,1 ms“.
- **Unerreichbare Ziele zählen**: wie viele unerreichbar, gestört und
  insgesamt sind, auf dem Server oder in einer Gruppe, und die Namen der
  unerreichbaren.

### Szenen-Ideen

- **Ein Ziel wird unerreichbar** (deine Internet-Box, 8.8.8.8) → eine
  Nachricht, oder die Box über eine smarte Steckdose neu starten.
- **Paketverlust über der Schwelle** → eine Nachricht mit dem Verlust, dann
  die Aktion „Kamerabild senden“ mit der SmokePing-Grafik.
- Jeden Morgen **Unerreichbare Ziele zählen** → eine Nachricht, wenn es
  welche gibt.

Um Rechner ohne SmokePing zu überwachen, siehe
[gladys-ping-wol](https://github.com/guim31/gladys-ping-wol); für
HTTP-Dienste [gladys-gatus](https://github.com/guim31/gladys-gatus).

## Fehlerbehebung

- **„SmokePing antwortet nicht“**: Prüfe Adresse und Port vom Rechner von
  Gladys aus und dass keine Firewall blockiert.
- **„Die RRD-Dateien werden unter der Datenadresse nicht bereitgestellt“**:
  Schritt 1 fehlt, oder die Adresse der Dateien ist eine andere: Öffne
  `…/smokeping-data/<Gruppe>/<Ziel>.rrd` in einem Browser.
- **„Keine SmokePing-Oberfläche unter dieser Adresse“**: Gib die Adresse der
  SmokePing-Seite oder von `smokeping.cgi` ein.
- **„Die Adresse leitet um“**: Gib die vollständige Adresse von
  `smokeping.cgi` ein, mit `https://`, wenn der Server dorthin umleitet.
- **„RRD-Datei nicht verstanden“**: Die Dateien stammen von einem Rechner,
  den die Integration nicht lesen kann (Big-Endian oder 32-Bit-x86); melde
  es in den Issues.
- **Ein Ziel fehlt**: Es muss im SmokePing-Menü stehen (nicht versteckt) und
  eine RRD-Datei haben; klicke nach einer Änderung der SmokePing-Konfiguration
  im Tab „Entdecken“ auf Suchen.

## Grenzen

- Nur die Messungen des SmokePing-Masters, nicht die seiner Slaves.
- Gladys liest die neueste Messung: Ein Ausfall, der kürzer als ein
  SmokePing-Schritt ist, kann übersehen werden, wie in seinen Grafiken.
- Ziele mit mehreren Hosts (Multi-Host-Grafiken) haben keine Datei: nicht
  angeboten.
- Die Grafik wird als PNG-Bild gesendet; Gladys zeigt sie an, ein Kanal, der
  nur JPEG annimmt, vielleicht nicht.
- Keine Verbindung zu SmokePing oder seinen Autoren.
