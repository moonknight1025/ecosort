import 'waste_category.dart';

/// Where an answer came from. Mirrors the backend's `source` field so the UI can
/// label guidance honestly instead of implying a model always ran.
enum ClassificationSource {
  aiVision('AI Vision'),
  rules('Offline rules');

  const ClassificationSource(this.label);

  final String label;

  static ClassificationSource fromApi(String? value) =>
      value == 'ai_vision' ? aiVision : rules;
}

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
    this.source = ClassificationSource.rules,
    this.confidence,
    this.preparationSteps = const <String>[],
    this.why = '',
    this.visionError,
    this.aiModel,
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

  /// AI vision or deterministic rules.
  final ClassificationSource source;

  /// Model confidence in 0..1, or null for rule-based answers.
  final double? confidence;

  /// Concrete recycling/preparation steps from the vision model.
  final List<String> preparationSteps;

  /// One sentence on why the item belongs to that stream.
  final String why;

  /// Present when vision was attempted but did not answer; explains the fallback.
  final String? visionError;

  final String? aiModel;

  String get pointsLabel => '+$points pts';

  /// `Confidence 91%`, or an empty string when the answer is rule-based.
  String get confidenceLabel {
    final double? value = confidence;
    if (value == null) {
      return '';
    }
    return 'Confidence ${(value * 100).round()}%';
  }

  /// Parsed from `POST /api/identify`. Kept here (not in the repository) so the
  /// mapping is unit-testable without an HTTP client.
  factory WasteClassification.fromApiJson(Map<String, dynamic> json) {
    final List<dynamic> rawSteps =
        (json['preparation_steps'] as List<dynamic>?) ?? const <dynamic>[];
    return WasteClassification(
      displayName: (json['display_name'] as String?) ?? 'Unrecognized Item',
      category: WasteCategory.fromLabel(json['category'] as String?),
      instructions: (json['instructions'] as String?) ?? '',
      points: (json['points'] as num?)?.toInt() ?? 10,
      isFallback: (json['fallback'] as bool?) ?? false,
      matchedKeyword: json['matched_keyword'] as String?,
      imageUrl: json['image_url'] as String?,
      source: ClassificationSource.fromApi(json['source'] as String?),
      confidence: (json['confidence'] as num?)?.toDouble(),
      preparationSteps: <String>[
        for (final dynamic step in rawSteps) step.toString(),
      ],
      why: (json['why'] as String?) ?? '',
      visionError: json['vision_error'] as String?,
      aiModel: json['ai_model'] as String?,
    );
  }
}
