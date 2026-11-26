import 'package:shared_preferences/shared_preferences.dart';

/// Minimal persistence seam so the local repository can be tested without the
/// platform channel, and so a web browser that blocks storage degrades to
/// in-memory instead of throwing.
abstract class KeyValueStore {
  Future<String?> read(String key);

  Future<void> write(String key, String value);
}

/// Test/session store: nothing survives a restart, nothing can fail.
class InMemoryKeyValueStore implements KeyValueStore {
  final Map<String, String> _values = <String, String>{};

  @override
  Future<String?> read(String key) async => _values[key];

  @override
  Future<void> write(String key, String value) async {
    _values[key] = value;
  }
}

/// Browser/desktop store backed by `shared_preferences`.
///
/// `SharedPreferences.getInstance()` can fail (private windows, blocked
/// storage, a test binding without the mock). Every failure falls back to a
/// process-local map, so the app stays usable during a demo instead of
/// crashing on launch.
class PreferencesKeyValueStore implements KeyValueStore {
  final Map<String, String> _memory = <String, String>{};
  bool _unavailable = false;

  Future<SharedPreferences?> _prefs() async {
    if (_unavailable) {
      return null;
    }
    try {
      return await SharedPreferences.getInstance();
    } catch (_) {
      _unavailable = true;
      return null;
    }
  }

  @override
  Future<String?> read(String key) async {
    final SharedPreferences? prefs = await _prefs();
    if (prefs == null) {
      return _memory[key];
    }
    return prefs.getString(key) ?? _memory[key];
  }

  @override
  Future<void> write(String key, String value) async {
    _memory[key] = value;
    final SharedPreferences? prefs = await _prefs();
    if (prefs == null) {
      return;
    }
    try {
      await prefs.setString(key, value);
    } catch (_) {
      _unavailable = true;
    }
  }
}
