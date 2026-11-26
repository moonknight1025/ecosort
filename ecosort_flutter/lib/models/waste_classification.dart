import 'waste_category.dart';

/// The outcome of one classification attempt.
class WasteClassification {
  const WasteClassification({
    required this.displayName,
    required this.category,
    required this.instructions,
    required this.points,
    required this.isFallback,
    this.matchedKeyword,
    this.imageUrl,
  });

  final String displayName;
  final WasteCategory category;
  final String instructions;
  final int points;

  /// True when nothing matched and the Dry Waste fallback was used, so the UI
  /// can say so instead of pretending it recognised the item.
  final bool isFallback;

  final String? matchedKeyword;
  final String? imageUrl;

  String get pointsLabel => '+$points pts';
}
