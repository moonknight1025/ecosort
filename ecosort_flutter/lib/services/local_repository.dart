import 'dart:convert';

import '../data/challenge_catalog.dart';
import '../data/classifier.dart';
import '../data/gamification.dart';
import '../models/app_snapshot.dart';
import '../models/challenge_day.dart';
import '../models/leaderboard.dart';
import '../models/user_profile.dart';
import '../models/waste_category.dart';
import '../models/waste_classification.dart';
import 'ecosort_repository.dart';
import 'key_value_store.dart';

/// Mutable per-user record, serialised as JSON so web reloads keep progress.
class _UserRecord {
  _UserRecord({
    required this.username,
    required this.campus,
    required this.points,
    required this.bins,
    required this.completedDays,
    required this.totalDisposals,
    required this.plasticDisposals,
    required this.hazardDisposals,
  });

  final String username;
  String campus;
  int points;
  final Map<WasteCategory, int> bins;
  final Set<int> completedDays;
  int totalDisposals;
  int plasticDisposals;
  int hazardDisposals;

  factory _UserRecord.seeded(String username, String campus, int points) {
    return _UserRecord(
      username: username,
      campus: campus,
      points: points,
      bins: <WasteCategory, int>{
        for (final WasteCategory category in WasteCategory.values) category: 0,
      },
      completedDays: <int>{},
      totalDisposals: 0,
      plasticDisposals: 0,
      hazardDisposals: 0,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'username': username,
        'campus': campus,
        'points': points,
        'bins': <String, int>{
          for (final MapEntry<WasteCategory, int> entry in bins.entries)
            entry.key.name: entry.value,
        },
        'completedDays': completedDays.toList()..sort(),
        'totalDisposals': totalDisposals,
        'plasticDisposals': plasticDisposals,
        'hazardDisposals': hazardDisposals,
      };

  factory _UserRecord.fromJson(Map<String, dynamic> json) {
    final Map<String, dynamic> rawBins =
        (json['bins'] as Map<String, dynamic>?) ?? <String, dynamic>{};
    return _UserRecord(
      username: (json['username'] as String?) ?? '',
      campus: (json['campus'] as String?) ?? defaultCampus,
      points: (json['points'] as num?)?.toInt() ?? 0,
      bins: <WasteCategory, int>{
        for (final WasteCategory category in WasteCategory.values)
          category: (rawBins[category.name] as num?)?.toInt() ?? 0,
      },
      completedDays: <int>{
        for (final dynamic day in (json['completedDays'] as List<dynamic>?) ?? const <dynamic>[])
          (day as num).toInt(),
      },
      totalDisposals: (json['totalDisposals'] as num?)?.toInt() ?? 0,
      plasticDisposals: (json['plasticDisposals'] as num?)?.toInt() ?? 0,
      hazardDisposals: (json['hazardDisposals'] as num?)?.toInt() ?? 0,
    );
  }
}

/// Default data mode: works with zero external dependencies, seeded demo users,
/// and `shared_preferences` persistence with an in-memory fallback.
///
/// The state machine here is the mock backend: it enforces the same rules the
/// Flask API will (points from the catalog, +15 once per challenge day), so
/// switching modes does not change what the user experiences.
class LocalRepository implements EcoSortRepository {
  LocalRepository({
    required KeyValueStore store,
    WasteClassifier classifier = const WasteClassifier(),
  })  : _store = store,
        _classifier = classifier;

  static const String storageKey = 'ecosort.users.v1';

  final KeyValueStore _store;
  final WasteClassifier _classifier;
  final Map<String, _UserRecord> _users = <String, _UserRecord>{};
  bool _loaded = false;

  Future<void> _ensureLoaded() async {
    if (_loaded) {
      return;
    }
    _loaded = true;
    final String? raw = await _store.read(storageKey);
    if (raw != null && raw.isNotEmpty) {
      try {
        final Map<String, dynamic> decoded =
            jsonDecode(raw) as Map<String, dynamic>;
        for (final MapEntry<String, dynamic> entry in decoded.entries) {
          _users[entry.key] =
              _UserRecord.fromJson(entry.value as Map<String, dynamic>);
        }
      } catch (_) {
        // Corrupt storage must not brick the app: fall through to the seed.
        _users.clear();
      }
    }
    if (_users.isEmpty) {
      for (final ({String username, String campus, int points}) sample
          in sampleUsers) {
        _users[sample.username] = _UserRecord.seeded(
          sample.username,
          sample.campus,
          sample.points,
        );
      }
    }
  }

  Future<void> _persist() async {
    final Map<String, dynamic> payload = <String, dynamic>{
      for (final MapEntry<String, _UserRecord> entry in _users.entries)
        entry.key: entry.value.toJson(),
    };
    await _store.write(storageKey, jsonEncode(payload));
  }

  /// Fetch (or create) a user record.
  ///
  /// [applyCampus] is true only for an explicit profile set: a disposal or a
  /// challenge claim must never silently move the user to another campus.
  Future<_UserRecord> _recordFor(
    String username,
    String campus, {
    bool applyCampus = false,
  }) async {
    await _ensureLoaded();
    final _UserRecord? existing = _users[username];
    if (existing != null) {
      if (applyCampus && existing.campus != campus) {
        existing.campus = campus;
        await _persist();
      }
      return existing;
    }
    final _UserRecord created = _UserRecord.seeded(username, campus, 0);
    _users[username] = created;
    await _persist();
    return created;
  }

  AppSnapshot _snapshot(_UserRecord record) {
    return AppSnapshot(
      user: UserProfile(
        username: record.username,
        campus: record.campus,
        ecoPoints: record.points,
      ),
      badges: evaluateBadges(
        totalDisposals: record.totalDisposals,
        plasticDisposals: record.plasticDisposals,
        hazardDisposals: record.hazardDisposals,
        ecoPoints: record.points,
      ),
      challenges: <ChallengeDay>[
        for (final MapEntry<int, String> entry in challengeTasks.entries)
          ChallengeDay(
            dayNumber: entry.key,
            task: entry.value,
            completed: record.completedDays.contains(entry.key),
          ),
      ],
      binCounts: Map<WasteCategory, int>.from(record.bins),
      totalDisposals: record.totalDisposals,
      plasticDisposals: record.plasticDisposals,
      hazardDisposals: record.hazardDisposals,
    );
  }

  @override
  Future<AppSnapshot> loadProfile({
    required String username,
    required String campus,
  }) async {
    final _UserRecord record =
        await _recordFor(username, campus, applyCampus: true);
    return _snapshot(record);
  }

  @override
  Future<WasteClassification> identify({
    String? presetKeyword,
    String? imageName,
    List<int>? imageBytes,
  }) async {
    return _classifier.classify(
      presetKeyword: presetKeyword,
      imageName: imageName,
    );
  }

  @override
  Future<AppSnapshot> dispose({
    required String username,
    required WasteClassification item,
  }) async {
    // Points always come from the classification, never from the caller.
    final _UserRecord record = await _recordFor(username, defaultCampus);
    record.points += item.points;
    record.bins[item.category] = (record.bins[item.category] ?? 0) + 1;
    record.totalDisposals += 1;
    if (plasticCategories.contains(item.category)) {
      record.plasticDisposals += 1;
    }
    if (hazardCategories.contains(item.category)) {
      record.hazardDisposals += 1;
    }
    await _persist();
    return _snapshot(record);
  }

  @override
  Future<AppSnapshot> claimChallenge({
    required String username,
    required int day,
  }) async {
    final _UserRecord record = await _recordFor(username, defaultCampus);
    if (!record.completedDays.contains(day)) {
      record.completedDays.add(day);
      record.points += challengeReward;
      await _persist();
    }
    return _snapshot(record);
  }

  @override
  Future<List<CampusStanding>> campusStandings() async {
    await _ensureLoaded();
    final Map<String, ({int points, int members})> totals =
        <String, ({int points, int members})>{};
    for (final _UserRecord record in _users.values) {
      final ({int points, int members}) current =
          totals[record.campus] ?? (points: 0, members: 0);
      totals[record.campus] = (
        points: current.points + record.points,
        members: current.members + 1,
      );
    }
    final List<CampusStanding> standings = <CampusStanding>[
      for (final MapEntry<String, ({int points, int members})> entry
          in totals.entries)
        CampusStanding(
          campus: entry.key,
          totalPoints: entry.value.points,
          members: entry.value.members,
        ),
    ];
    standings.sort((CampusStanding a, CampusStanding b) {
      final int byPoints = b.totalPoints.compareTo(a.totalPoints);
      return byPoints != 0 ? byPoints : a.campus.compareTo(b.campus);
    });
    return standings;
  }

  @override
  Future<List<LeaderboardEntry>> topUsers() async {
    await _ensureLoaded();
    final List<_UserRecord> sorted = _users.values.toList()
      ..sort((_UserRecord a, _UserRecord b) {
        final int byPoints = b.points.compareTo(a.points);
        return byPoints != 0 ? byPoints : a.username.compareTo(b.username);
      });
    return <LeaderboardEntry>[
      for (final _UserRecord record in sorted.take(10))
        LeaderboardEntry(
          username: record.username,
          campus: record.campus,
          points: record.points,
        ),
    ];
  }
}
