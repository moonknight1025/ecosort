import 'waste_category.dart';

/// Where an answer came from. Mirrors the backend's `source` field so the UI can
/// label guidance honestly instead of implying a model always ran.
enum ClassificationSource {
  aiVision('AI Vision'),
  rules('Offline rules');

  const ClassificationSource(this.label);

  final String label;

  /// `analysis_mode` is the documented field; `source` is accepted from older
  /// servers, and anything unrecognised means the deterministic rules answered.
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
    this.confidenceScore,
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

  /// Model confidence band: "High", "Medium" or "Low". Null for rule answers —
  /// the app never invents a confidence it was not given.
  final String? confidence;

  /// Optional numeric score, when a server supplies one alongside the band.
  final double? confidenceScore;

  /// Concrete recycling/preparation steps from the vision model.
  final List<String> preparationSteps;

  /// One sentence on why the item belongs to that stream.
  final String why;

  /// Present when vision was attempted but did not answer; explains the fallback.
  final String? visionError;

  final String? aiModel;

  String get pointsLabel => '+$points pts';

  /// `Confidence: High`, or an empty string when the answer is rule-based.
  String get confidenceLabel {
    final String? band = confidence;
    if (band == null || band.isEmpty) {
      return '';
    }
    final double? score = confidenceScore;
    return score == null
        ? 'Confidence: $band'
        : 'Confidence: $band (${(score * 100).round()}%)';
  }

  /// Parsed from `POST /api/identify`. Kept here (not in the repository) so the
  /// mapping is unit-testable without an HTTP client.
  factory WasteClassification.fromApiJson(Map<String, dynamic> json) {
    final List<dynamic> rawSteps =
        (json['preparation_steps'] as List<dynamic>?) ?? const <dynamic>[];
    final dynamic rawConfidence = json['confidence'];
    return WasteClassification(
      displayName: (json['item_name'] as String?) ??
          (json['display_name'] as String?) ??
          'Unrecognized Item',
      category: WasteCategory.fromLabel(json['category'] as String?),
      instructions: (json['instructions'] as String?) ?? '',
      points: (json['points'] as num?)?.toInt() ?? 10,
      isFallback: (json['fallback'] as bool?) ?? false,
      matchedKeyword: json['matched_keyword'] as String?,
      imageUrl: json['image_url'] as String?,
      source: ClassificationSource.fromApi(
        (json['analysis_mode'] as String?) ?? (json['source'] as String?),
      ),
      // The backend sends a band ("High"); an older server may send 0..1.
      confidence: _bandFrom(rawConfidence, json['confidence_score']),
      confidenceScore: _scoreFrom(rawConfidence, json['confidence_score']),
      preparationSteps: <String>[
        for (final dynamic step in rawSteps) step.toString(),
      ],
      why: (json['why'] as String?) ?? '',
      visionError: json['vision_error'] as String?,
      aiModel: json['ai_model'] as String?,
    );
  }

  static String? _bandFrom(dynamic value, dynamic score) {
    if (value is String && value.trim().isNotEmpty) {
      return value.trim();
    }
    final double? numeric = (value as num?)?.toDouble() ??
        (score as num?)?.toDouble();
    if (numeric == null) {
      return null;
    }
    if (numeric >= 0.75) {
      return 'High';
    }
    return numeric >= 0.45 ? 'Medium' : 'Low';
  }

  static double? _scoreFrom(dynamic value, dynamic score) {
    final double? explicit = (score as num?)?.toDouble();
    if (explicit != null) {
      return explicit;
    }
    return value is num ? value.toDouble() : null;
  }
}
