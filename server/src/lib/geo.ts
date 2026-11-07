/**
 * Country → state/region → main cities, for targeting campaigns. Not exhaustive: users can type any
 * other city by hand. Country names match the campaign country chips (and the caller-ID country map).
 */
export interface GeoCountry { name: string; iso: string; dial: string; regionLabel: string; regions: Record<string, string[]> }

export const GEO: GeoCountry[] = [
  { name: 'USA', iso: 'US', dial: '+1', regionLabel: 'State', regions: {
    Alabama: ['Birmingham', 'Montgomery', 'Huntsville', 'Mobile'], Alaska: ['Anchorage', 'Fairbanks', 'Juneau'],
    Arizona: ['Phoenix', 'Tucson', 'Mesa', 'Scottsdale', 'Chandler'], Arkansas: ['Little Rock', 'Fayetteville', 'Fort Smith'],
    California: ['Los Angeles', 'San Diego', 'San Jose', 'San Francisco', 'Sacramento', 'Fresno', 'Oakland', 'Irvine'],
    Colorado: ['Denver', 'Colorado Springs', 'Aurora', 'Boulder', 'Fort Collins'], Connecticut: ['Hartford', 'New Haven', 'Stamford', 'Bridgeport'],
    Delaware: ['Wilmington', 'Dover', 'Newark'], 'District of Columbia': ['Washington'],
    Florida: ['Miami', 'Orlando', 'Tampa', 'Jacksonville', 'Fort Lauderdale', 'St. Petersburg', 'Naples'],
    Georgia: ['Atlanta', 'Savannah', 'Augusta', 'Athens'], Hawaii: ['Honolulu', 'Hilo'], Idaho: ['Boise', 'Idaho Falls', 'Coeur d’Alene'],
    Illinois: ['Chicago', 'Naperville', 'Springfield', 'Peoria'], Indiana: ['Indianapolis', 'Fort Wayne', 'Bloomington'],
    Iowa: ['Des Moines', 'Cedar Rapids', 'Iowa City'], Kansas: ['Wichita', 'Overland Park', 'Kansas City'],
    Kentucky: ['Louisville', 'Lexington', 'Bowling Green'], Louisiana: ['New Orleans', 'Baton Rouge', 'Lafayette', 'Shreveport'],
    Maine: ['Portland', 'Bangor'], Maryland: ['Baltimore', 'Bethesda', 'Annapolis', 'Rockville'],
    Massachusetts: ['Boston', 'Cambridge', 'Worcester', 'Springfield'], Michigan: ['Detroit', 'Grand Rapids', 'Ann Arbor', 'Lansing'],
    Minnesota: ['Minneapolis', 'St. Paul', 'Rochester', 'Duluth'], Mississippi: ['Jackson', 'Gulfport', 'Hattiesburg'],
    Missouri: ['Kansas City', 'St. Louis', 'Springfield', 'Columbia'], Montana: ['Billings', 'Missoula', 'Bozeman'],
    Nebraska: ['Omaha', 'Lincoln'], Nevada: ['Las Vegas', 'Henderson', 'Reno'], 'New Hampshire': ['Manchester', 'Nashua', 'Concord'],
    'New Jersey': ['Newark', 'Jersey City', 'Hoboken', 'Princeton'], 'New Mexico': ['Albuquerque', 'Santa Fe', 'Las Cruces'],
    'New York': ['New York City', 'Brooklyn', 'Buffalo', 'Rochester', 'Albany', 'Syracuse'],
    'North Carolina': ['Charlotte', 'Raleigh', 'Durham', 'Greensboro', 'Asheville'], 'North Dakota': ['Fargo', 'Bismarck'],
    Ohio: ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Dayton'], Oklahoma: ['Oklahoma City', 'Tulsa', 'Norman'],
    Oregon: ['Portland', 'Eugene', 'Salem', 'Bend'], Pennsylvania: ['Philadelphia', 'Pittsburgh', 'Allentown', 'Harrisburg'],
    'Rhode Island': ['Providence', 'Newport'], 'South Carolina': ['Charleston', 'Columbia', 'Greenville', 'Myrtle Beach'],
    'South Dakota': ['Sioux Falls', 'Rapid City'], Tennessee: ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga'],
    Texas: ['Houston', 'Dallas', 'Austin', 'San Antonio', 'Fort Worth', 'El Paso', 'Plano'], Utah: ['Salt Lake City', 'Provo', 'Park City'],
    Vermont: ['Burlington', 'Montpelier'], Virginia: ['Virginia Beach', 'Richmond', 'Arlington', 'Norfolk', 'Alexandria'],
    Washington: ['Seattle', 'Spokane', 'Tacoma', 'Bellevue'], 'West Virginia': ['Charleston', 'Morgantown'],
    Wisconsin: ['Milwaukee', 'Madison', 'Green Bay'], Wyoming: ['Cheyenne', 'Jackson'],
  } },
  { name: 'United Kingdom', iso: 'GB', dial: '+44', regionLabel: 'Region', regions: {
    'Greater London': ['London', 'Croydon', 'Camden', 'Westminster', 'Richmond'],
    'South East England': ['Brighton', 'Oxford', 'Reading', 'Southampton', 'Guildford', 'Milton Keynes'],
    'South West England': ['Bristol', 'Bath', 'Exeter', 'Plymouth', 'Bournemouth'],
    'East of England': ['Cambridge', 'Norwich', 'Ipswich', 'Chelmsford'],
    'West Midlands': ['Birmingham', 'Coventry', 'Wolverhampton', 'Stoke-on-Trent'], 'East Midlands': ['Nottingham', 'Leicester', 'Derby', 'Northampton'],
    'North West England': ['Manchester', 'Liverpool', 'Preston', 'Chester', 'Bolton'], 'North East England': ['Newcastle', 'Sunderland', 'Durham', 'Middlesbrough'],
    'Yorkshire': ['Leeds', 'Sheffield', 'York', 'Bradford', 'Hull'],
    Scotland: ['Edinburgh', 'Glasgow', 'Aberdeen', 'Dundee', 'Inverness'], Wales: ['Cardiff', 'Swansea', 'Newport'], 'Northern Ireland': ['Belfast', 'Derry'],
  } },
  { name: 'Canada', iso: 'CA', dial: '+1', regionLabel: 'Province', regions: {
    Ontario: ['Toronto', 'Ottawa', 'Mississauga', 'Hamilton', 'London'], Quebec: ['Montreal', 'Quebec City', 'Laval', 'Gatineau'],
    'British Columbia': ['Vancouver', 'Victoria', 'Surrey', 'Burnaby', 'Kelowna'], Alberta: ['Calgary', 'Edmonton', 'Red Deer'],
    Manitoba: ['Winnipeg', 'Brandon'], Saskatchewan: ['Saskatoon', 'Regina'], 'Nova Scotia': ['Halifax', 'Sydney'],
    'New Brunswick': ['Moncton', 'Saint John', 'Fredericton'], Newfoundland: ['St. John’s'], 'Prince Edward Island': ['Charlottetown'],
  } },
  { name: 'Australia', iso: 'AU', dial: '+61', regionLabel: 'State', regions: {
    'New South Wales': ['Sydney', 'Newcastle', 'Wollongong'], Victoria: ['Melbourne', 'Geelong', 'Ballarat'], Queensland: ['Brisbane', 'Gold Coast', 'Cairns', 'Sunshine Coast'],
    'Western Australia': ['Perth', 'Fremantle'], 'South Australia': ['Adelaide'], Tasmania: ['Hobart', 'Launceston'],
    'Australian Capital Territory': ['Canberra'], 'Northern Territory': ['Darwin'],
  } },
  { name: 'UAE', iso: 'AE', dial: '+971', regionLabel: 'Emirate', regions: {
    Dubai: ['Dubai'], 'Abu Dhabi': ['Abu Dhabi', 'Al Ain'], Sharjah: ['Sharjah'], Ajman: ['Ajman'], 'Ras Al Khaimah': ['Ras Al Khaimah'], Fujairah: ['Fujairah'], 'Umm Al Quwain': ['Umm Al Quwain'],
  } },
  { name: 'Ireland', iso: 'IE', dial: '+353', regionLabel: 'County', regions: {
    Dublin: ['Dublin'], Cork: ['Cork'], Galway: ['Galway'], Limerick: ['Limerick'], Waterford: ['Waterford'], Kildare: ['Naas', 'Newbridge'],
  } },
  { name: 'Singapore', iso: 'SG', dial: '+65', regionLabel: 'Region', regions: {
    Central: ['Orchard', 'Marina Bay', 'Tanjong Pagar'], East: ['Tampines', 'Bedok'], West: ['Jurong'], North: ['Woodlands'], 'North-East': ['Punggol', 'Sengkang'],
  } },
  { name: 'New Zealand', iso: 'NZ', dial: '+64', regionLabel: 'Region', regions: {
    Auckland: ['Auckland'], Wellington: ['Wellington'], Canterbury: ['Christchurch'], Waikato: ['Hamilton'], Otago: ['Dunedin', 'Queenstown'], 'Bay of Plenty': ['Tauranga'],
  } },
  { name: 'India', iso: 'IN', dial: '+91', regionLabel: 'State', regions: {
    Maharashtra: ['Mumbai', 'Pune', 'Nagpur', 'Nashik'], Karnataka: ['Bengaluru', 'Mysuru', 'Mangaluru'], Delhi: ['New Delhi'],
    'Tamil Nadu': ['Chennai', 'Coimbatore', 'Madurai'], Telangana: ['Hyderabad'], Gujarat: ['Ahmedabad', 'Surat', 'Vadodara'],
    'West Bengal': ['Kolkata'], Rajasthan: ['Jaipur', 'Udaipur'], 'Madhya Pradesh': ['Indore', 'Bhopal'], 'Uttar Pradesh': ['Lucknow', 'Noida', 'Kanpur'],
    Kerala: ['Kochi', 'Thiruvananthapuram'], Haryana: ['Gurugram'], Punjab: ['Chandigarh', 'Ludhiana'],
  } },
];

const norm = (s: string) => s.trim().toLowerCase();

/** “Texas, USA” → a city in Texas; “Austin, Texas, USA” → as is. Used by the sandbox provider. */
export function expandLocation(loc: string, pickIndex: number): { city: string; region?: string; country?: string } {
  const parts = loc.split(',').map((s) => s.trim()).filter(Boolean);
  const country = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const geo = GEO.find((g) => country && (norm(g.name) === norm(country) || norm(g.iso) === norm(country) || (g.iso === 'US' && /united states|^us$/i.test(country)) || (g.iso === 'GB' && /^uk$|england/i.test(country))));
  if (geo) {
    if (parts.length === 2) {
      const region = Object.keys(geo.regions).find((r) => norm(r) === norm(parts[0]));
      if (region) { const cities = geo.regions[region]; return { city: cities[pickIndex % cities.length], region, country: geo.name }; }
      return { city: parts[0], country: geo.name, region: Object.keys(geo.regions).find((r) => geo.regions[r].some((c) => norm(c) === norm(parts[0]))) };
    }
    if (parts.length === 1) { const regions = Object.keys(geo.regions); const region = regions[pickIndex % regions.length]; return { city: geo.regions[region][0], region, country: geo.name }; }
  }
  if (parts.length === 1) {
    const g = GEO.find((x) => norm(x.name) === norm(parts[0]));
    if (g) { const regions = Object.keys(g.regions); const region = regions[pickIndex % regions.length]; return { city: g.regions[region][pickIndex % g.regions[region].length], region, country: g.name }; }
  }
  return { city: parts[0], region: parts.length >= 3 ? parts[1] : undefined, country };
}
