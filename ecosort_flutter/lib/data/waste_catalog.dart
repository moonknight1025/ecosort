import '../models/waste_category.dart';

/// One row of the deterministic catalog. Mirrors `CATALOG_SEED` in the Flask
/// backend, including point values, so both data modes agree.
class CatalogEntry {
  const CatalogEntry({
    required this.keyword,
    required this.displayName,
    required this.category,
    required this.instructions,
    required this.points,
  });

  final String keyword;
  final String displayName;
  final WasteCategory category;
  final String instructions;
  final int points;
}

/// The canonical catalog: 13 items across all five streams.
const List<CatalogEntry> wasteCatalog = <CatalogEntry>[
  CatalogEntry(
    keyword: 'banana',
    displayName: 'Banana Peel',
    category: WasteCategory.wet,
    instructions:
        'Drop it in the green wet-waste bin, ideally loose rather than in a '
        'plastic bag, so the community compost pile can take it.',
    points: 10,
  ),
  CatalogEntry(
    keyword: 'apple',
    displayName: 'Fruit Core',
    category: WasteCategory.wet,
    instructions:
        'Chop it small if you can, then add it to the green bin with the rest '
        "of the day's food waste.",
    points: 10,
  ),
  CatalogEntry(
    keyword: 'food',
    displayName: 'Leftover Food Scraps',
    category: WasteCategory.wet,
    instructions:
        'Scrape the plate into the green bin and keep wrappers out so the load '
        'stays compostable.',
    points: 10,
  ),
  CatalogEntry(
    keyword: 'bottle',
    displayName: 'Plastic Water Bottle',
    category: WasteCategory.recyclable,
    instructions:
        'Empty and rinse the bottle, crush it flat, cap it, then drop it in the '
        'blue recyclables bin.',
    points: 15,
  ),
  CatalogEntry(
    keyword: 'plastic',
    displayName: 'Plastic Container',
    category: WasteCategory.recyclable,
    instructions:
        'Rinse out any food residue, stack it with other rigid plastics, and '
        'place it in the blue bin.',
    points: 15,
  ),
  CatalogEntry(
    keyword: 'box',
    displayName: 'Cardboard Box',
    category: WasteCategory.recyclable,
    instructions:
        'Remove tape and flatten the box so it stacks neatly in the blue '
        'recyclables bin.',
    points: 15,
  ),
  CatalogEntry(
    keyword: 'paper',
    displayName: 'Clean Paper / Newspaper',
    category: WasteCategory.recyclable,
    instructions:
        'Keep it dry, bundle the sheets together, and add them to the blue '
        'paper stream.',
    points: 10,
  ),
  CatalogEntry(
    keyword: 'wrapper',
    displayName: 'Soiled Multi-layer Wrapper',
    category: WasteCategory.dry,
    instructions:
        'Multi-layer wrappers cannot be recycled. Bag them and drop them in the '
        'gray dry-waste bin.',
    points: 10,
  ),
  CatalogEntry(
    keyword: 'tissue',
    displayName: 'Used Napkin / Tissue',
    category: WasteCategory.dry,
    instructions:
        'Toss the soiled napkin into the gray dry-waste bin; it is not '
        'compostable once it has touched food.',
    points: 10,
  ),
  CatalogEntry(
    keyword: 'charger',
    displayName: 'Broken Charger / Cable',
    category: WasteCategory.ewaste,
    instructions:
        'Coil the cable, bag it separately, and hand it to the purple e-waste '
        'bin so the copper can be recovered.',
    points: 20,
  ),
  CatalogEntry(
    keyword: 'phone',
    displayName: 'Old Electronic Device',
    category: WasteCategory.ewaste,
    instructions:
        'Wipe your data, remove the SIM, and place the handset in the purple '
        'e-waste bin. Never put it in general waste.',
    points: 25,
  ),
  CatalogEntry(
    keyword: 'battery',
    displayName: 'Used Alkaline / Li-ion Battery',
    category: WasteCategory.hazardous,
    instructions:
        'Tape the terminals, keep it away from heat, and drop it in the red '
        'hazardous-waste bin. Never bin a battery loose.',
    points: 25,
  ),
  CatalogEntry(
    keyword: 'med',
    displayName: 'Expired Medicine / Chemical',
    category: WasteCategory.hazardous,
    instructions:
        'Leave the medicine in its blister or bottle, seal it in a bag, and '
        'place it in the red hazardous-waste bin.',
    points: 25,
  ),
];

/// Everyday words that resolve to a seeded keyword. Kept separate so the
/// 13-row catalog contract stays intact (mirrors `CATALOG_ALIASES` in Flask).
const Map<String, String> catalogAliases = <String, String>{
  'medicine': 'med',
  'medicines': 'med',
  'medication': 'med',
  'meds': 'med',
  'pills': 'med',
  'earbuds': 'phone',
  'laptop': 'phone',
  'mobile': 'phone',
  'smartphone': 'phone',
};

/// Keywords shorter than this may only match a whole token, never a substring.
const int minSubstringKeywordLength = 5;

/// The six one-tap demo chips, in the order they appear in the UI.
const List<({String label, String keyword})> presetSamples =
    <({String label, String keyword})>[
  (label: 'Plastic Bottle', keyword: 'bottle'),
  (label: 'Banana Peel', keyword: 'banana'),
  (label: 'Used Battery', keyword: 'battery'),
  (label: 'Cardboard Box', keyword: 'box'),
  (label: 'Broken Charger', keyword: 'charger'),
  (label: 'Chip Wrapper', keyword: 'wrapper'),
];
