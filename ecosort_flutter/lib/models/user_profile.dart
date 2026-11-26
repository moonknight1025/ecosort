/// A campus user. `id` is present only when the record came from the Flask
/// backend; local mode identifies users by username alone.
class UserProfile {
  const UserProfile({
    required this.username,
    required this.campus,
    required this.ecoPoints,
    this.id,
  });

  final String username;
  final String campus;
  final int ecoPoints;
  final int? id;

  UserProfile copyWith({String? username, String? campus, int? ecoPoints}) {
    return UserProfile(
      id: id,
      username: username ?? this.username,
      campus: campus ?? this.campus,
      ecoPoints: ecoPoints ?? this.ecoPoints,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'username': username,
        'campus': campus,
        'eco_points': ecoPoints,
      };

  factory UserProfile.fromJson(Map<String, dynamic> json) {
    return UserProfile(
      id: (json['id'] as num?)?.toInt(),
      username: (json['username'] as String?) ?? '',
      campus: (json['campus'] as String?) ?? defaultCampus,
      ecoPoints: (json['eco_points'] as num?)?.toInt() ?? 0,
    );
  }
}

/// The four supported campuses, in their canonical spelling.
const List<String> campuses = <String>[
  'North Campus',
  'South Hostel',
  'Science Block',
  'Main Campus',
];

const String defaultCampus = 'Main Campus';
