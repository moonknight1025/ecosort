import 'package:material_ui/material_ui.dart';

/// The five waste streams. The `label` strings are the canonical literals used
/// by the Flask backend, SQLite rows, API payloads and the UI alike — never
/// retype them anywhere else.
enum WasteCategory {
  wet('Wet Waste', 'Green', Color(0xFF2E7D32), 10),
  recyclable('Recyclable Waste', 'Blue', Color(0xFF1565C0), 15),
  dry('Dry Waste', 'Gray', Color(0xFF546E7A), 10),
  ewaste('E-Waste', 'Purple', Color(0xFF6A1B9A), 20),
  hazardous('Hazardous Waste', 'Red', Color(0xFFC62828), 25);

  const WasteCategory(this.label, this.binColorName, this.color, this.basePoints);

  /// Canonical category literal, e.g. `Recyclable Waste`.
  final String label;

  /// Canonical bin colour name, e.g. `Blue`.
  final String binColorName;

  /// The bin's accent colour, mirroring the Flask hex values.
  final Color color;

  /// Representative reward; individual catalog rows may pay more.
  final int basePoints;

  /// Unknown literals from the API degrade to the Dry Waste fallback rather
  /// than throwing — the UI must render something.
  static WasteCategory fromLabel(String? label) {
    for (final category in values) {
      if (category.label == label) {
        return category;
      }
    }
    return WasteCategory.dry;
  }

  /// Short label used on narrow bin tiles.
  String get shortLabel => switch (this) {
        WasteCategory.wet => 'Wet',
        WasteCategory.recyclable => 'Recyclable',
        WasteCategory.dry => 'Dry',
        WasteCategory.ewaste => 'E-Waste',
        WasteCategory.hazardous => 'Hazardous',
      };

  /// Emoji used on bin tiles and cards (kept in one place for consistency).
  String get emoji => switch (this) {
        WasteCategory.wet => '🥬',
        WasteCategory.recyclable => '♻️',
        WasteCategory.dry => '🗑️',
        WasteCategory.ewaste => '🔌',
        WasteCategory.hazardous => '⚠️',
      };
}
