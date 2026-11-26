/// One group's standing in the Community & Group leaderboard.
class GroupStanding {
  const GroupStanding({
    required this.groupName,
    required this.totalPoints,
    required this.members,
  });

  final String groupName;
  final int totalPoints;
  final int members;

  factory GroupStanding.fromJson(Map<String, dynamic> json) {
    return GroupStanding(
      groupName: (json['group_name'] as String?) ??
          (json['campus'] as String?) ??
          'Unknown',
      totalPoints: (json['total_points'] as num?)?.toInt() ??
          (json['points'] as num?)?.toInt() ??
          0,
      members: (json['members'] as num?)?.toInt() ?? 0,
    );
  }
}

/// One row of the Top Eco Contributors leaderboard.
class LeaderboardEntry {
  const LeaderboardEntry({
    required this.username,
    required this.groupName,
    required this.city,
    required this.points,
  });

  final String username;
  final String groupName;
  final String city;
  final int points;

  /// "Home & Family · Chennai", skipping whatever is missing.
  String get subtitle =>
      <String>[if (groupName.isNotEmpty) groupName, if (city.isNotEmpty) city]
          .join(' · ');

  factory LeaderboardEntry.fromJson(Map<String, dynamic> json) {
    return LeaderboardEntry(
      username: (json['username'] as String?) ?? '',
      groupName: (json['group_name'] as String?) ??
          (json['campus'] as String?) ??
          '',
      city: (json['city'] as String?) ?? '',
      points: (json['eco_points'] as num?)?.toInt() ??
          (json['points'] as num?)?.toInt() ??
          0,
    );
  }
}
