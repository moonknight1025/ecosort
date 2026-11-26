import '../models/waste_category.dart';
import '../models/waste_classification.dart';
import 'waste_catalog.dart';

/// Deterministic, offline classifier.
///
/// Same rules as the Flask `classify_waste()` helper, deliberately:
///  * matching is case-insensitive and token-first;
///  * a keyword may match a substring only when it is at least
///    [minSubstringKeywordLength] characters, which stops the 3-character `med`
///    keyword from firing on `media_player.png`;
///  * aliases map everyday words onto a seeded keyword;
///  * anything unmatched, empty or unrecognised falls back to Dry Waste.
///
/// This is the seam a vision model would replace later: callers only depend on
/// [classify].
class WasteClassifier {
  const WasteClassifier();

  static final RegExp _tokenSplitter = RegExp('[^a-z0-9]+');

  /// Rank a keyword against the input; 0 means "no match".
  int _score(String keyword, Set<String> tokens, String haystack) {
    final String lowered = keyword.toLowerCase();
    if (tokens.contains(lowered)) {
      return 1000 + lowered.length;
    }
    if (lowered.length >= minSubstringKeywordLength &&
        haystack.contains(lowered)) {
      return lowered.length;
    }
    return 0;
  }

  WasteClassification classify({String? presetKeyword, String? imageName}) {
    final String haystack = <String>[
      if ((presetKeyword ?? '').trim().isNotEmpty) presetKeyword!.trim(),
      if ((imageName ?? '').trim().isNotEmpty) _basename(imageName!.trim()),
    ].join(' ').toLowerCase();

    final Set<String> tokens = <String>{
      for (final String token in haystack.split(_tokenSplitter))
        if (token.isNotEmpty) token,
    };
    final Set<String> expandedTokens = <String>{
      ...tokens,
      for (final String token in tokens)
        if (catalogAliases.containsKey(token)) catalogAliases[token]!,
    };

    CatalogEntry? best;
    int bestScore = 0;
    for (final CatalogEntry entry in wasteCatalog) {
      final int score = _score(entry.keyword, expandedTokens, haystack);
      if (score > bestScore ||
          (score == bestScore && score > 0 && best != null && entry.keyword.compareTo(best.keyword) > 0)) {
        bestScore = score;
        best = entry;
      }
    }

    if (best != null) {
      return WasteClassification(
        displayName: best.displayName,
        category: best.category,
        instructions: best.instructions,
        points: best.points,
        isFallback: false,
        matchedKeyword: best.keyword,
      );
    }

    return const WasteClassification(
      displayName: 'Unrecognized Item',
      category: WasteCategory.dry,
      instructions:
          'We could not match this item to a known stream. Bag it and drop it '
          'in the gray dry-waste bin; a campus volunteer will re-sort it.',
      points: 10,
      isFallback: true,
    );
  }

  /// Only the basename participates, so a full path or a sanitised name behaves
  /// the same way as the original upload name.
  String _basename(String path) {
    final int slash = path.lastIndexOf(RegExp(r'[/\\]'));
    return slash == -1 ? path : path.substring(slash + 1);
  }
}
