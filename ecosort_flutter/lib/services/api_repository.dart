import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/app_snapshot.dart';
import '../models/badge_state.dart';
import '../models/challenge_day.dart';
import '../models/leaderboard.dart';
import '../models/user_profile.dart';
import '../models/waste_category.dart';
import '../models/waste_classification.dart';
import 'ecosort_repository.dart';

/// Talks to the Flask backend (`app.py` in the `ecosort` repository).
///
/// Every transport problem, non-2xx status or malformed payload becomes an
/// [EcoSortBackendException]; the controller turns that into a switch to local
/// mode. This class never invents a success.
class ApiRepository implements EcoSortRepository {
  ApiRepository({
    required this.baseUrl,
    http.Client? client,
    this.timeout = const Duration(seconds: 4),
  }) : _client = client ?? http.Client();

  final Uri baseUrl;
  final Duration timeout;
  final http.Client _client;

  /// Flask user ids, keyed by username, learned from `/api/user`.
  final Map<String, int> _userIds = <String, int>{};
  final Map<String, String> _groups = <String, String>{};
  final Map<String, String> _cities = <String, String>{};

  static const Map<String, String> _headers = <String, String>{
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  Uri _endpoint(String path) => baseUrl.resolve(path);

  int _tokenCounter = 0;

  /// Unique per request; the server dedupes on (user_id, client_token).
  String _newClientToken() {
    _tokenCounter += 1;
    return 'flutter-${DateTime.now().microsecondsSinceEpoch}-$_tokenCounter';
  }

  Exception _transportError(Object error) =>
      EcoSortBackendException('cannot reach $baseUrl ($error)');

  Future<Map<String, dynamic>> _decode(http.Response response, String route) async {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      String detail = '';
      try {
        final dynamic body = jsonDecode(response.body);
        if (body is Map<String, dynamic>) {
          detail = (body['error'] as String?) ?? '';
        }
      } catch (_) {
        detail = response.body.isEmpty ? '' : response.body;
      }
      String message =
          '$route returned ${response.statusCode}${detail.isEmpty ? '' : ': $detail'}';
      if (response.statusCode == 429) {
        final String? retryAfter = response.headers['retry-after'];
        message = detail.isEmpty ? 'Too many requests' : detail;
        if (retryAfter != null && retryAfter.isNotEmpty) {
          message = '$message (retry in ${retryAfter}s)';
        }
      }
      throw EcoSortBackendException(message);
    }
    try {
      final dynamic body = jsonDecode(response.body);
      if (body is! Map<String, dynamic>) {
        throw const FormatException('expected a JSON object');
      }
      return body;
    } on FormatException catch (error) {
      throw EcoSortBackendException('$route returned unreadable JSON ($error)');
    }
  }

  AppSnapshot _snapshotFrom(Map<String, dynamic> json) {
    final Map<String, dynamic> user =
        (json['user'] as Map<String, dynamic>?) ?? <String, dynamic>{};
    final Map<String, dynamic> rawBins =
        (json['bin_counts'] as Map<String, dynamic>?) ?? <String, dynamic>{};

    final Map<WasteCategory, int> bins = <WasteCategory, int>{
      for (final WasteCategory category in WasteCategory.values)
        category: (rawBins[category.label] as num?)?.toInt() ?? 0,
    };
    final int plastic = (bins[WasteCategory.recyclable] ?? 0) +
        (bins[WasteCategory.dry] ?? 0);
    final int hazard = (bins[WasteCategory.ewaste] ?? 0) +
        (bins[WasteCategory.hazardous] ?? 0);
    final int total = bins.values.fold<int>(0, (int sum, int value) => sum + value);

    final List<dynamic> rawBadges =
        (json['badges'] as List<dynamic>?) ?? const <dynamic>[];

    return AppSnapshot(
      user: UserProfile.fromJson(user),
      badges: <BadgeState>[
        for (final dynamic badge in rawBadges)
          BadgeState.fromJson(badge as Map<String, dynamic>),
      ],
      challenges: <ChallengeDay>[
        for (final dynamic day
            in (json['challenges'] as List<dynamic>?) ?? const <dynamic>[])
          ChallengeDay.fromJson(day as Map<String, dynamic>),
      ],
      binCounts: bins,
      totalDisposals: total,
      plasticDisposals: plastic,
      hazardDisposals: hazard,
    );
  }

  @override
  Future<AppSnapshot> loadProfile({
    required String username,
    required String groupName,
    required String city,
  }) async {
    final http.Response response;
    try {
      response = await _client
          .post(
            _endpoint('/api/user'),
            headers: _headers,
            body: jsonEncode(<String, String>{
              'username': username,
              'group_name': groupName,
              'city': city,
            }),
          )
          .timeout(timeout);
    } catch (error) {
      throw _transportError(error);
    }
    final Map<String, dynamic> json = await _decode(response, '/api/user');
    final AppSnapshot snapshot = _snapshotFrom(json);
    _userIds[snapshot.user.username] = snapshot.user.id ?? -1;
    _groups[snapshot.user.username] = snapshot.user.groupName;
    _cities[snapshot.user.username] = snapshot.user.city;
    return snapshot;
  }

  @override
  Future<WasteClassification> identify({
    String? presetKeyword,
    String? imageName,
    List<int>? imageBytes,
  }) async {
    final http.Response response;
    try {
      if (imageBytes != null && imageName != null) {
        final http.MultipartRequest request =
            http.MultipartRequest('POST', _endpoint('/api/identify'))
              ..fields['preset_keyword'] = presetKeyword ?? ''
              ..files.add(
                http.MultipartFile.fromBytes(
                  'image',
                  imageBytes,
                  filename: imageName,
                ),
              );
        response = await http.Response.fromStream(
          await _client.send(request).timeout(timeout),
        );
      } else {
        final http.MultipartRequest request =
            http.MultipartRequest('POST', _endpoint('/api/identify'))
              ..fields['preset_keyword'] = presetKeyword ?? '';
        response = await http.Response.fromStream(
          await _client.send(request).timeout(timeout),
        );
      }
    } catch (error) {
      throw _transportError(error);
    }

    final Map<String, dynamic> json = await _decode(response, '/api/identify');
    return WasteClassification.fromApiJson(json);
  }

  Future<AppSnapshot> _mutate({
    required String route,
    required Map<String, dynamic> body,
    required String username,
  }) async {
    final http.Response response;
    try {
      response = await _client
          .post(_endpoint(route), headers: _headers, body: jsonEncode(body))
          .timeout(timeout);
    } catch (error) {
      throw _transportError(error);
    }
    await _decode(response, route);
    // The mutation routes return only the delta; re-read the profile so the UI
    // always renders one authoritative state.
    return loadProfile(
      username: username,
      groupName: _groups[username] ?? defaultGroup,
      city: _cities[username] ?? defaultCity,
    );
  }

  @override
  Future<AppSnapshot> dispose({
    required String username,
    required WasteClassification item,
  }) async {
    return _mutate(
      route: '/api/dispose',
      body: <String, dynamic>{
        'user_id': _userIds[username] ?? -1,
        'item_name': item.displayName,
        // Sent for compatibility with the documented contract, but the server
        // re-derives both and ignores these.
        'category': item.category.label,
        'points': item.points,
        // The server dedupes on (user_id, client_token), so a retried disposal
        // cannot double-credit points.
        'client_token': _newClientToken(),
      },
      username: username,
    );
  }

  @override
  Future<AppSnapshot> claimChallenge({
    required String username,
    required int day,
  }) async {
    return _mutate(
      route: '/api/challenge/complete',
      body: <String, dynamic>{
        'user_id': _userIds[username] ?? -1,
        'day_number': day,
      },
      username: username,
    );
  }

  @override
  Future<List<GroupStanding>> groupStandings() async {
    final Map<String, dynamic> json = await _leaderboardJson();
    // `groups` is current; `campuses` is accepted from an older server.
    final List<dynamic> raw = (json['groups'] as List<dynamic>?) ??
        (json['campuses'] as List<dynamic>?) ??
        const <dynamic>[];
    return <GroupStanding>[
      for (final dynamic row in raw)
        GroupStanding.fromJson(row as Map<String, dynamic>),
    ];
  }

  @override
  Future<List<LeaderboardEntry>> topUsers() async {
    final Map<String, dynamic> json = await _leaderboardJson();
    final List<dynamic> raw = (json['users'] as List<dynamic>?) ?? const <dynamic>[];
    return <LeaderboardEntry>[
      for (final dynamic row in raw)
        LeaderboardEntry.fromJson(row as Map<String, dynamic>),
    ];
  }

  Future<Map<String, dynamic>> _leaderboardJson() async {
    final http.Response response;
    try {
      response = await _client.get(_endpoint('/api/leaderboard')).timeout(timeout);
    } catch (error) {
      throw _transportError(error);
    }
    return _decode(response, '/api/leaderboard');
  }
}
