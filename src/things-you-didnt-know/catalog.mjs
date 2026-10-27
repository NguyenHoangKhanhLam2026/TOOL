// The 195-country baseline is the 193 UN Member States plus the two UN
// non-member observer States (Holy See and State of Palestine). Region labels
// are for balanced content rotation; country names use reader-friendly forms.
export const COUNTRY_CATALOG_SOURCE = Object.freeze({
  title: 'United Nations Member States and Non-Member Observer States',
  memberStatesUrl: 'https://www.un.org/about-us/member-states',
  observerStatesUrl: 'https://www.un.org/en/node/123012',
  count: 195
});

const rawCountries = `
DZ|Algeria|Africa
AO|Angola|Africa
BJ|Benin|Africa
BW|Botswana|Africa
BF|Burkina Faso|Africa
BI|Burundi|Africa
CV|Cabo Verde|Africa
CM|Cameroon|Africa
CF|Central African Republic|Africa
TD|Chad|Africa
KM|Comoros|Africa
CG|Republic of the Congo|Africa
CD|Democratic Republic of the Congo|Africa
CI|Côte d'Ivoire|Africa
DJ|Djibouti|Africa
EG|Egypt|Africa
GQ|Equatorial Guinea|Africa
ER|Eritrea|Africa
SZ|Eswatini|Africa
ET|Ethiopia|Africa
GA|Gabon|Africa
GM|Gambia|Africa
GH|Ghana|Africa
GN|Guinea|Africa
GW|Guinea-Bissau|Africa
KE|Kenya|Africa
LS|Lesotho|Africa
LR|Liberia|Africa
LY|Libya|Africa
MG|Madagascar|Africa
MW|Malawi|Africa
ML|Mali|Africa
MR|Mauritania|Africa
MU|Mauritius|Africa
MA|Morocco|Africa
MZ|Mozambique|Africa
NA|Namibia|Africa
NE|Niger|Africa
NG|Nigeria|Africa
RW|Rwanda|Africa
ST|São Tomé and Príncipe|Africa
SN|Senegal|Africa
SC|Seychelles|Africa
SL|Sierra Leone|Africa
SO|Somalia|Africa
ZA|South Africa|Africa
SS|South Sudan|Africa
SD|Sudan|Africa
TG|Togo|Africa
TN|Tunisia|Africa
UG|Uganda|Africa
TZ|Tanzania|Africa
ZM|Zambia|Africa
ZW|Zimbabwe|Africa
AF|Afghanistan|Asia
AM|Armenia|Asia
AZ|Azerbaijan|Asia
BH|Bahrain|Asia
BD|Bangladesh|Asia
BT|Bhutan|Asia
BN|Brunei|Asia
KH|Cambodia|Asia
CN|China|Asia
CY|Cyprus|Asia
GE|Georgia|Asia
IN|India|Asia
ID|Indonesia|Asia
IR|Iran|Asia
IQ|Iraq|Asia
IL|Israel|Asia
JP|Japan|Asia
JO|Jordan|Asia
KZ|Kazakhstan|Asia
KW|Kuwait|Asia
KG|Kyrgyzstan|Asia
LA|Laos|Asia
LB|Lebanon|Asia
MY|Malaysia|Asia
MV|Maldives|Asia
MN|Mongolia|Asia
MM|Myanmar|Asia
NP|Nepal|Asia
KP|North Korea|Asia
OM|Oman|Asia
PK|Pakistan|Asia
PS|State of Palestine|Asia
PH|Philippines|Asia
QA|Qatar|Asia
SA|Saudi Arabia|Asia
SG|Singapore|Asia
KR|South Korea|Asia
LK|Sri Lanka|Asia
SY|Syria|Asia
TJ|Tajikistan|Asia
TH|Thailand|Asia
TL|Timor-Leste|Asia
TR|Türkiye|Asia
TM|Turkmenistan|Asia
AE|United Arab Emirates|Asia
UZ|Uzbekistan|Asia
VN|Vietnam|Asia
YE|Yemen|Asia
AL|Albania|Europe
AD|Andorra|Europe
AT|Austria|Europe
BY|Belarus|Europe
BE|Belgium|Europe
BA|Bosnia and Herzegovina|Europe
BG|Bulgaria|Europe
HR|Croatia|Europe
CZ|Czechia|Europe
DK|Denmark|Europe
EE|Estonia|Europe
FI|Finland|Europe
FR|France|Europe
DE|Germany|Europe
GR|Greece|Europe
HU|Hungary|Europe
IS|Iceland|Europe
IE|Ireland|Europe
IT|Italy|Europe
LV|Latvia|Europe
LI|Liechtenstein|Europe
LT|Lithuania|Europe
LU|Luxembourg|Europe
MT|Malta|Europe
MD|Moldova|Europe
MC|Monaco|Europe
ME|Montenegro|Europe
NL|Netherlands|Europe
MK|North Macedonia|Europe
NO|Norway|Europe
PL|Poland|Europe
PT|Portugal|Europe
RO|Romania|Europe
RU|Russia|Europe
SM|San Marino|Europe
RS|Serbia|Europe
SK|Slovakia|Europe
SI|Slovenia|Europe
ES|Spain|Europe
SE|Sweden|Europe
CH|Switzerland|Europe
UA|Ukraine|Europe
GB|United Kingdom|Europe
VA|Holy See|Europe
AG|Antigua and Barbuda|North America
BS|Bahamas|North America
BB|Barbados|North America
BZ|Belize|North America
CA|Canada|North America
CR|Costa Rica|North America
CU|Cuba|North America
DM|Dominica|North America
DO|Dominican Republic|North America
SV|El Salvador|North America
GD|Grenada|North America
GT|Guatemala|North America
HT|Haiti|North America
HN|Honduras|North America
JM|Jamaica|North America
MX|Mexico|North America
NI|Nicaragua|North America
PA|Panama|North America
KN|Saint Kitts and Nevis|North America
LC|Saint Lucia|North America
VC|Saint Vincent and the Grenadines|North America
TT|Trinidad and Tobago|North America
US|United States|North America
AR|Argentina|South America
BO|Bolivia|South America
BR|Brazil|South America
CL|Chile|South America
CO|Colombia|South America
EC|Ecuador|South America
GY|Guyana|South America
PY|Paraguay|South America
PE|Peru|South America
SR|Suriname|South America
UY|Uruguay|South America
VE|Venezuela|South America
AU|Australia|Oceania
FJ|Fiji|Oceania
KI|Kiribati|Oceania
MH|Marshall Islands|Oceania
FM|Micronesia|Oceania
NR|Nauru|Oceania
NZ|New Zealand|Oceania
PW|Palau|Oceania
PG|Papua New Guinea|Oceania
WS|Samoa|Oceania
SB|Solomon Islands|Oceania
TO|Tonga|Oceania
TV|Tuvalu|Oceania
VU|Vanuatu|Oceania
`;

export const COUNTRY_CATALOG = Object.freeze(rawCountries.trim().split(/\r?\n/u).map((line) => {
  const [id, name, continent] = line.split('|');
  return Object.freeze({ id, name, continent });
}));

if (COUNTRY_CATALOG.length !== COUNTRY_CATALOG_SOURCE.count
  || new Set(COUNTRY_CATALOG.map((country) => country.id)).size !== COUNTRY_CATALOG.length) {
  throw new Error('Things You Didn\'t Know: country catalog must contain 195 unique ISO 3166-1 alpha-2 IDs.');
}

export const TOPIC_GROUPS = Object.freeze([
  { id: 'daily-life', name: 'Daily life' },
  { id: 'customs-etiquette', name: 'Customs and etiquette' },
  { id: 'family-children', name: 'Family and children' },
  { id: 'school-study', name: 'School and study' },
  { id: 'work-habits', name: 'Work habits' },
  { id: 'leisure-recreation', name: 'Leisure and recreation' },
  { id: 'eating-table-manners', name: 'Eating habits and table manners' },
  { id: 'transport', name: 'Transport' },
  { id: 'housing-neighborhoods', name: 'Housing and neighborhoods' },
  { id: 'greetings-language', name: 'Greetings and language habits' },
  { id: 'money-shopping', name: 'Money and shopping' },
  { id: 'community-neighbors', name: 'Community and neighbors' },
  { id: 'holidays-celebrations', name: 'Holidays and celebrations' }
]);
