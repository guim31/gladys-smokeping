# SmokePing

[SmokePing](https://oss.oetiker.ch/smokeping/) mesure la latence et les pertes
de paquets de votre connexion vers des cibles choisies, et dessine ses
fameux graphiques « en fumée ». Cette intégration amène ses cibles dans
Gladys : chaque cible devient un appareil avec sa latence médiane, ses pertes,
sa gigue et son graphique, des scènes réagissent quand une cible devient
injoignable ou dégradée, et un widget du tableau de bord les montre toutes.

Gladys lit SmokePing : elle ne pingue pas vos cibles elle-même. Tout reste sur
votre réseau (aucun cloud).

Testée contre un vrai SmokePing en Docker (SmokePing 2.9.0, image
`lscr.io/linuxserver/smokeping`) : cibles joignables, injoignables et avec
des pertes provoquées exprès. Vos retours sont les bienvenus dans
[les issues](https://github.com/guim31/gladys-smokeping/issues).

## Ce qu'il faut

- Gladys Assistant 5.1.0 ou plus récent.
- SmokePing 2.7 ou plus récent, son interface web joignable depuis Gladys.
- Une ligne dans la configuration de son serveur web, pour que Gladys lise
  les mesures (ci-dessous). SmokePing n'a pas d'API : ses chiffres ne sont
  que dans ses fichiers RRD.

## Mise en route

### 1. Servir les fichiers RRD

SmokePing garde un fichier RRD par cible dans son dossier `data`. Servez ce
dossier en lecture seule à l'adresse `/smokeping-data/` du même serveur web.

**Image Docker `lscr.io/linuxserver/smokeping`** : créez le fichier
`site-confs/gladys.conf` dans le dossier monté sur `/config`, puis redémarrez
le conteneur :

```apache
Alias /smokeping-data /data
<Directory "/data">
    Options -Indexes
    Require all granted
</Directory>
```

**Paquet Debian ou Ubuntu (Apache)** : les mêmes lignes avec
`/var/lib/smokeping` à la place de `/data`, dans
`/etc/apache2/conf-available/smokeping-data.conf`, puis
`a2enconf smokeping-data` et rechargez Apache.

**Nginx** : `location /smokeping-data/ { alias /var/lib/smokeping/; }`.

Vérifiez : `http://<votre SmokePing>/smokeping-data/<Groupe>/<Cible>.rrd` doit
télécharger un fichier. Ces fichiers contiennent les mêmes chiffres que la
page de SmokePing ; restreignez-les comme elle (`Require ip 192.168.1.0/24`,
un identifiant) si besoin.

### 2. Configurer l'intégration

Dans Gladys, ouvrez l'intégration et remplissez :

- **Adresse de SmokePing** : l'adresse de sa page web, par exemple
  `http://192.168.1.2/smokeping/`, ou de son `smokeping.cgi`
  (`http://192.168.1.2/cgi-bin/smokeping.cgi` avec le paquet Debian).
- **Adresse des fichiers RRD** : laissez-la vide si vous avez suivi l'étape 1.
- **Utilisateur** et **Mot de passe** : seulement si le serveur web demande
  un identifiant. Ils ne partent jamais vers une adresse des fichiers RRD
  située sur un autre serveur.
- **Seuil de pertes de paquets** (10 % par défaut) et **Seuil de latence**
  (100 ms) : au-delà, une cible est dégradée.
- **Mesures consécutives** : combien de mesures SmokePing de suite au-delà
  d'un seuil, ou sans aucune réponse, avant une alerte (2 par défaut).
  SmokePing mesure toutes les 5 minutes par défaut : 2, c'est 10 minutes.
- **Intervalle de rafraîchissement** : de 1 à 5 minutes (1 minute par
  défaut). Quelques petites requêtes par cible à chaque fois.
- **Période du graphique** : 3 heures, 30 heures ou 10 jours.
- **Langue des noms** : langue des noms des fonctionnalités et des résultats
  de scène (français par défaut).

Cliquez ensuite sur **Tester la connexion** : elle lit SmokePing et compte les
cibles.

### 3. Ajouter les cibles

Ouvrez l'onglet **Découverte** de l'intégration : un appareil par cible
SmokePing, nommé comme dans son menu (les groupes ne sont pas des appareils).
Ajoutez celles à suivre. Les déclencheurs de scène et le widget fonctionnent
pour toutes les cibles, ajoutées ou non.

## Les appareils

Chaque cible :

- **Joignable** : oui quand au moins un ping a répondu lors de la dernière
  mesure, non après le nombre choisi de mesures sans aucune réponse.
- **Latence médiane** : le temps d'aller-retour médian, en millisecondes.
- **Pertes de paquets** : la part des pings perdus, en pourcentage.
- **Gigue** : l'écart type des temps d'aller-retour, en millisecondes.
- **Dernière mesure** : l'heure de la dernière mesure de SmokePing, dans le
  fuseau de Gladys.
- **Graphique SmokePing** : le graphique SmokePing de la cible, en image de
  caméra, rafraîchi toutes les 5 minutes et à la demande.

Les mesures partent au plus toutes les 5 minutes, tout de suite quand l'état
change. Une cible que SmokePing ne mesure plus affiche le badge injoignable et
n'envoie rien.

## Tableau de bord

Le widget **SmokePing** montre trois tuiles (cibles injoignables, dégradées,
latence médiane) et une ligne par cible, les injoignables et dégradées
d'abord, avec leur latence et leurs pertes. Dans ses réglages, choisissez un
groupe, ou des cibles ajoutées à Gladys, et masquez les tuiles ou le bouton
**Actualiser**. Le bouton **Actualiser** relit SmokePing tout de suite.

Le widget **Caméra** du tableau de bord montre le graphique d'une cible.

## Scènes

### Déclencheurs

- **Une cible devient injoignable** : tous les pings d'une cible sont perdus,
  autant de mesures de suite que réglé. Variables : nom de la cible, groupe.
- **Une cible est de nouveau joignable** : une cible injoignable répond de
  nouveau. Variables : nom de la cible, groupe, durée de la coupure en
  minutes.
- **Pertes de paquets au-dessus du seuil** : les pertes d'une cible joignable
  atteignent le seuil, sur des mesures consécutives. Variables : nom de la
  cible, groupe, pertes de paquets.
- **Latence au-dessus du seuil** : la latence médiane atteint le seuil, sur
  des mesures consécutives. Variables : nom de la cible, groupe, latence
  médiane.

Tous peuvent être limités à certaines cibles. Aucun événement à la première
lecture : seulement les vrais changements. Une alerte ne se redéclenche
qu'après un retour sous le seuil. Une cible devenue injoignable pendant un
redémarrage de Gladys est quand même annoncée, une fois.

### Actions

- **État d'une cible** : joignable ou non, état en toutes lettres, latence
  médiane, pertes, gigue, et une phrase toute prête comme « Box : Joignable,
  23,4 ms, 12 % de pertes, gigue 3,1 ms ».
- **Compter les cibles injoignables** : combien sont injoignables, dégradées
  et au total, sur le serveur ou dans un groupe, et les noms des injoignables.

### Idées de scènes

- **Une cible devient injoignable** (votre box, 8.8.8.8) → un message, ou
  redémarrer la box par une prise connectée.
- **Pertes de paquets au-dessus du seuil** → un message avec les pertes, puis
  l'action « Envoyer une image de caméra » avec le graphique SmokePing.
- Chaque matin, **Compter les cibles injoignables** → un message s'il y en a.

Pour surveiller des machines sans SmokePing, voir
[gladys-ping-wol](https://github.com/guim31/gladys-ping-wol) ; pour des
services HTTP, [gladys-gatus](https://github.com/guim31/gladys-gatus).

## Dépannage

- **« SmokePing ne répond pas »** : vérifiez l'adresse et le port depuis la
  machine de Gladys, et qu'un pare-feu ne bloque pas.
- **« Les fichiers RRD ne sont pas servis à l'adresse des données »** :
  l'étape 1 manque, ou l'adresse des fichiers diffère : ouvrez
  `…/smokeping-data/<Groupe>/<Cible>.rrd` dans un navigateur.
- **« Aucune interface SmokePing à cette adresse »** : saisissez l'adresse de
  la page SmokePing ou de `smokeping.cgi`.
- **« L'adresse redirige »** : saisissez l'adresse complète de
  `smokeping.cgi`, en `https://` si le serveur y redirige.
- **« Fichier RRD incompris »** : les fichiers viennent d'une machine que
  l'intégration ne sait pas lire (gros-boutiste, ou x86 32 bits) ;
  signalez-le dans les issues.
- **Une cible manque** : elle doit figurer dans le menu de SmokePing (non
  masquée) et avoir un fichier RRD ; cliquez sur Rechercher dans l'onglet
  Découverte après un changement de la configuration de SmokePing.

## Limites

- Les mesures du SmokePing maître seulement, pas de ses esclaves.
- Gladys lit la mesure la plus récente : une coupure plus courte qu'un pas de
  SmokePing peut passer inaperçue, comme sur ses graphiques.
- Les cibles à plusieurs hôtes (graphiques multi-hôtes) n'ont pas de fichier :
  non proposées.
- Le graphique part en image PNG ; Gladys l'affiche, un canal qui n'accepte
  que le JPEG peut ne pas l'afficher.
- Sans lien avec SmokePing ni ses auteurs.
