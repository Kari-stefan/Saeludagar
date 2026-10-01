# Requirements


## Tilgangur
    Vefsíða fyrir skólann sem auðveldar nemendum að skrá sig í atburði á Sæludegi. Nemendur geta skráð sig inn með kennitölu og valið þá atburði sem þeir vilja sækja. Ef atburðir eru ætlaðir ákveðnum brautum er hægt að sía framboðið til að auðvelda leitina.


## Aðalnotandi
    - Aðalnotendur: Nemendur sem skrá sig í atburði.
    - Auka/Stjórnendur: Kennarar sem búa til, kynna og stýra atburðum.



## Vandamál
    - Fyrir nemendur: Útrýmir erfiðleikum og ruglingi við skráningu á atburði Sæludaga.
    - Fyrir kennara: Auðveldar kennurum að kynna atburði sína og halda utan um þátttöku nemenda.


## Functional Requirements
    FR-01: Kerfið býður upp á innskráningarsíðu þar sem nemandi skráir sig inn með kennitölu.
    FR-02: Kennarar geta skráð sig inn í kennaraviðmót með sérstökum "Kennarakóða".
    FR-03: Nemendur geta síað atburði eftir námsbraut.
?   FR-04: Ef slegin er inn kennitala sem finnst ekki í gagnagrunni skólans birtir kerfið skýr villuboð.
    FR-05: Kennarar geta stofnað nýja atburði með eftirfarandi upplýsingum: Titill, Mótshaldari/Veitandi, Námsbraut (ef við á), Lýsing/Upplýsingar, Hámarksfjöldi þátttakenda, Þátttökugjald, og Mynd.
    FR-06: Kerfið sýnir upplýsingasíðu atburðar (atburðaprófíl) ásamt stöðu skráninga (fjöldi skráðra og hvort uppselt sé).
?   FR-07: Kerfið staðfestir identity notanda við innskráningu (t.d. með kennitöluúttekt í gagnagrunni eða fastkóðuðum lykilorðum/pín-númerum).
    FR-08: Nemendur geta skráð sig á atburð ef enn er laust pláss, og afskráð sig aftur ef þeir skipta um skoðun.
    FR-09: Kennarar geta séð lista yfir alla skráða nemendur í sínum atburði, bætt nemendum við handvirkt, eða fjarlægt þá.
    FR-10: Kennarar geta merkt við viðveru/mætingu nemenda á atburðinum.


## Non-Functional Requirements  
?   NFR-01: Kennitölur nemenda skulu vera dulkóðaðar/hashed í gagnagrunninum.
    NFR-02: Vefviðmótið á að vera fullkomlega viðbragðsfljótt (responsive) og notendavænt á bæði tölvum og farsímum.
    NFR-03: Vefsíðan skal virka hnökralaust í Chrome, Firefox og Safari.
    NFR-04: Kerfið á að geta þjónustað allt að 1.000 samtímanotendur (concurrent users).


## User Stories
    Sem kennari vil ég geta séð hvernig atburðurinn minn birtist nemendum.
    Sem kennari vil ég geta bætt nemendum handvirkt við atburð eða fjarlægt þá.
    Sem kennari vil ég geta séð yfirlit yfir alla skráða nemendur í mínum atburði.
    Sem kennari vil ég geta sent tölvupóst á alla skráða nemendur í mínum atburði.
    Sem kennari vil ég geta skráð og séð mætingu nemenda á sjálfum deginum.


## Tæki
    Backend: NodeJS
    Templating: EJS
    styling: SCSS (fært yfir í CSS)
    Database: SQL-Lite
    Frontend Scripting: JavaScript