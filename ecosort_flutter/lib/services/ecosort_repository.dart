import '../models/app_snapshot.dart';
import '../models/leaderboard.dart';
import '../models/waste_classification.dart';

/// The one interface the UI depends on. Local mode and Flask mode are two
/// implementations, which is what keeps the widgets data-source agnostic.
abstract class EcoSortRepository {
  /// Create or rehydrate a profile and return its full state.
  Future<AppSnapshot> loadProfile({
    required String username,
    required String groupName,
    required String city,
  });

  /// Classify a preset keyword and/or an uploaded file name.
  Future<WasteClassification> identify({
    String? presetKeyword,
    String? imageName,
    List<int>? imageBytes,
  });

  /// Log a disposal, awarding the catalog points for [item].
  Future<AppSnapshot> dispose({
    required String username,
    required WasteClassification item,
  });

  /// Claim one challenge day; a repeat claim awards nothing.
  Future<AppSnapshot> claimChallenge({
    required String username,
    required int day,
  });

  Future<List<GroupStanding>> groupStandings();

  Future<List<LeaderboardEntry>> topUsers();
}

/// Raised when a backend call cannot be completed. The controller treats this
/// as "switch to local mode and retry", never as a fatal error.
class EcoSortBackendException implements Exception {
  EcoSortBackendException(this.message);

  final String message;

  @override
  String toString() => 'EcoSortBackendException: $message';
}

/// Which side of the repository abstraction is currently serving the UI.
enum DataMode {
  local('Local / mock'),
  api('Flask backend');

  const DataMode(this.label);

  final String label;
}
