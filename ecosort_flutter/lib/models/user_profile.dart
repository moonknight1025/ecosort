/// A user profile. `id` is present only when the record came from the Flask
/// backend; local mode identifies users by username alone.
///
/// The product is universal: a group is any household, street, society, office
/// or region, and the city is free text with a gentle default.
class UserProfile {
  const UserProfile({
    required this.username,
    required this.groupName,
    required this.city,
    required this.ecoPoints,
    this.id,
  });

  final String username;

  /// Community / group, e.g. "Home & Family" or "My Flat 4B".
  final String groupName;

  /// City / region, e.g. "Chennai" or "Local Area".
  final String city;

  final int ecoPoints;
  final int? id;

  UserProfile copyWith({
    String? username,
    String? groupName,
    String? city,
    int? ecoPoints,
  }) {
    return UserProfile(
      id: id,
      username: username ?? this.username,
      groupName: groupName ?? this.groupName,
      city: city ?? this.city,
      ecoPoints: ecoPoints ?? this.ecoPoints,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'username': username,
        'group_name': groupName,
        'city': city,
        'eco_points': ecoPoints,
      };

  /// Tolerates an older server that still answers with `campus`.
  factory UserProfile.fromJson(Map<String, dynamic> json) {
    return UserProfile(
      id: (json['id'] as num?)?.toInt(),
      username: (json['username'] as String?) ?? '',
      groupName: (json['group_name'] as String?) ??
          (json['campus'] as String?) ??
          defaultGroup,
      city: (json['city'] as String?) ?? defaultCity,
      ecoPoints: (json['eco_points'] as num?)?.toInt() ?? 0,
    );
  }
}

/// Suggestions, not a whitelist: users may type any group or city.
const List<String> groupSuggestions = <String>[
  'General Community',
  'Home & Family',
  'Neighborhood / Ward',
  'Apartment Society',
  'Workplace / Office',
];

const List<String> citySuggestions = <String>[
  'Local Area',
  'Chennai',
  'Coimbatore',
  'Madurai',
  'Bengaluru',
  'Mumbai',
  'Delhi',
];

const String defaultGroup = 'General Community';
const String defaultCity = 'Local Area';
