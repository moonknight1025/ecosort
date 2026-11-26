/// Aggregated campus standing in the Campus Cleanliness Battle.
class CampusStanding {
  const CampusStanding({
    required this.campus,
    required this.totalPoints,
    required this.members,
  });

  final String campus;
  final int totalPoints;
  final int members;

  factory CampusStanding.fromJson(Map<String, dynamic> json) {
    return CampusStanding(
      campus: (json['campus'] as String?) ?? 'Unknown',
      totalPoints: (json['total_points'] as num?)?.toInt() ??
          (json['points'] as num?)?.toInt() ??
          0,
      members: (json['members'] as num?)?.toInt() ?? 0,
    );
  }
}

/// One row of the Top Eco Warriors leaderboard.
class LeaderboardEntry {
  const LeaderboardEntry({
    required this.username,
    required this.campus,
    required this.points,
  });

  final String username;
  final String campus;
  final int points;

  factory LeaderboardEntry.fromJson(Map<String, dynamic> json) {
    return LeaderboardEntry(
      username: (json['username'] as String?) ?? '',
      campus: (json['campus'] as String?) ?? '',
      points: (json['eco_points'] as num?)?.toInt() ??
          (json['points'] as num?)?.toInt() ??
          0,
    );
  }
}
