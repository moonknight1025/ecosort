import 'package:flutter/foundation.dart';

import '../models/app_snapshot.dart';
import '../models/leaderboard.dart';
import '../models/user_profile.dart';
import '../models/waste_classification.dart';
import 'api_repository.dart';
import 'ecosort_repository.dart';
import 'key_value_store.dart';
import 'local_repository.dart';

/// Default backend target; the Flask app in the sibling repository listens here.
final Uri defaultApiBaseUrl = Uri.parse('http://127.0.0.1:5000');

/// Owns the UI state and decides which repository serves it.
///
/// Fallback rule: any [EcoSortBackendException] while in API mode switches the
/// whole session to local mode and retries the same operation there, so a demo
/// keeps working with the backend stopped. The switch is global (not per call)
/// to avoid a UI that mixes an API snapshot with a local leaderboard.
class EcoSortController extends ChangeNotifier {
  EcoSortController({
    KeyValueStore? store,
    LocalRepository? local,
    Uri? apiBaseUrl,
    String initialUsername = 'You',
    String initialGroup = defaultGroup,
    String initialCity = defaultCity,
  })  : _local = local ?? LocalRepository(store: store ?? PreferencesKeyValueStore()),
        _apiBaseUrl = apiBaseUrl ?? defaultApiBaseUrl,
        _username = initialUsername,
        _groupName = initialGroup,
        _city = initialCity;

  final LocalRepository _local;
  final Uri _apiBaseUrl;
  ApiRepository? _api;

  EcoSortRepository get _repository =>
      _mode == DataMode.api ? (_api ??= ApiRepository(baseUrl: _apiBaseUrl)) : _local;

  DataMode _mode = DataMode.local;
  AppSnapshot? _snapshot;
  WasteClassification? _classification;
  List<GroupStanding> _groupStandings = const <GroupStanding>[];
  List<LeaderboardEntry> _topUsers = const <LeaderboardEntry>[];
  bool _busy = false;
  String? _notice;
  String? _error;
  String _username;
  String _groupName;
  String _city;
  bool _initialised = false;

  DataMode get mode => _mode;
  AppSnapshot? get snapshot => _snapshot;
  WasteClassification? get classification => _classification;
  List<GroupStanding> get groupStandings => _groupStandings;
  List<LeaderboardEntry> get topUsers => _topUsers;
  bool get busy => _busy;
  String? get notice => _notice;
  String? get error => _error;
  String get username => _username;
  String get groupName => _groupName;
  String get city => _city;

  /// Loads the profile once; safe to call from `initState`.
  Future<void> initialise() async {
    if (_initialised) {
      return;
    }
    _initialised = true;
    await _reload();
  }

  void clearNotice() {
    if (_notice == null && _error == null) {
      return;
    }
    _notice = null;
    _error = null;
    notifyListeners();
  }

  /// Switch data source. Switching to API mode attempts one call; if it fails
  /// the controller silently lands back in local mode with a notice.
  Future<void> setMode(DataMode mode) async {
    if (_mode == mode) {
      return;
    }
    _mode = mode;
    _notice = mode == DataMode.api
        ? 'Trying the Flask backend at $_apiBaseUrl…'
        : 'Using local mode.';
    notifyListeners();
    await _reload();
  }

  Future<void> setProfile({
    required String username,
    required String groupName,
    required String city,
  }) async {
    final String trimmed = username.trim();
    if (trimmed.isEmpty) {
      _error = 'Enter a name first.';
      notifyListeners();
      return;
    }
    _username = trimmed;
    _groupName = groupName.trim().isEmpty ? defaultGroup : groupName.trim();
    _city = city.trim().isEmpty ? defaultCity : city.trim();
    _classification = null;
    await _reload();
  }

  Future<void> _reload() async {
    _busy = true;
    notifyListeners();
    try {
      _snapshot = await _withFallback(
        (EcoSortRepository repo) => repo.loadProfile(
          username: _username,
          groupName: _groupName,
          city: _city,
        ),
      );
      _error = null;
    } catch (error) {
      _error = _describe(error);
    } finally {
      _busy = false;
    }
    await refreshLeaderboards();
  }

  /// Runs [action], switching to local mode once if the backend fails.
  Future<T> _withFallback<T>(Future<T> Function(EcoSortRepository repo) action) async {
    try {
      return await action(_repository);
    } on EcoSortBackendException catch (error) {
      if (_mode == DataMode.api) {
        _mode = DataMode.local;
        _notice =
            'Backend unavailable (${error.message}). Switched to local mode.';
        return action(_local);
      }
      rethrow;
    }
  }

  Future<void> refreshLeaderboards() async {
    final DataMode before = _mode;
    try {
      _groupStandings = await _withFallback(
        (EcoSortRepository repo) => repo.groupStandings(),
      );
      _topUsers = await _withFallback(
        (EcoSortRepository repo) => repo.topUsers(),
      );
      if (_groupStandings.isEmpty && _topUsers.isEmpty) {
        _error ??= 'No leaderboard data yet.';
      }
    } catch (error) {
      _error = _describe(error);
    }
    if (before != _mode) {
      // The fallback happened mid-refresh: re-read the profile locally so the
      // points on screen match the standings underneath them.
      _snapshot = await _local.loadProfile(
        username: _username,
        groupName: _groupName,
        city: _city,
      );
    }
    notifyListeners();
  }

  Future<bool> identifyPreset(String keyword) => _identify(presetKeyword: keyword);

  Future<bool> identifyFile({required String fileName, required List<int> bytes}) =>
      _identify(imageName: fileName, imageBytes: bytes);

  Future<bool> _identify({String? presetKeyword, String? imageName, List<int>? imageBytes}) async {
    if (_busy) {
      return false;
    }
    _busy = true;
    _error = null;
    notifyListeners();
    try {
      _classification = await _withFallback(
        (EcoSortRepository repo) => repo.identify(
          presetKeyword: presetKeyword,
          imageName: imageName,
          imageBytes: imageBytes,
        ),
      );
      final WasteClassification item = _classification!;
      _notice = item.isFallback
          ? 'No catalog match — sorted as ${item.category.label}.'
          : '${item.displayName} → ${item.category.label}';
      return true;
    } catch (error) {
      _error = _describe(error);
      return false;
    } finally {
      _busy = false;
      notifyListeners();
    }
  }

  /// Log the currently classified item. Returns true when a disposal landed.
  Future<bool> disposeCurrent() async {
    final WasteClassification? item = _classification;
    if (item == null || _busy) {
      return false;
    }
    _busy = true;
    _error = null;
    notifyListeners();
    try {
      _snapshot = await _withFallback(
        (EcoSortRepository repo) =>
            repo.dispose(username: _username, item: item),
      );
      _classification = null;
      _notice = '${item.displayName} tossed into ${item.category.label} '
          '(+${item.points} pts)';
      return true;
    } catch (error) {
      _error = _describe(error);
      return false;
    } finally {
      _busy = false;
      notifyListeners();
      await refreshLeaderboards();
    }
  }

  /// Claim one challenge day. A duplicate claim awards nothing.
  Future<bool> claimDay(int day) async {
    if (_busy) {
      return false;
    }
    final String? error = await _claim(day);
    if (error != null) {
      _error = error;
      return false;
    }
    return true;
  }

  Future<String?> _claim(int day) async {
    _busy = true;
    _error = null;
    notifyListeners();
    final int before = _snapshot?.user.ecoPoints ?? 0;
    try {
      final AppSnapshot updated = await _withFallback(
        (EcoSortRepository repo) =>
            repo.claimChallenge(username: _username, day: day),
      );
      _snapshot = updated;
      final int delta = updated.user.ecoPoints - before;
      _notice = delta > 0
          ? 'Day $day claimed (+$delta pts)'
          : 'Day $day was already claimed.';
      return null;
    } catch (error) {
      return _describe(error);
    } finally {
      _busy = false;
      notifyListeners();
      await refreshLeaderboards();
    }
  }

  String _describe(Object error) {
    if (error is EcoSortBackendException) {
      return error.message;
    }
    return '$error';
  }
}
