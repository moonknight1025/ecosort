/// The 7-Day Zero-Waste Challenge. Day numbers are the primary key; the task
/// text is canonical here and mirrored by `CHALLENGE_TASKS` in the Flask app.
const Map<int, String> challengeTasks = <int, String>{
  1: 'Carry a reusable bottle all day',
  2: 'Segregate wet and dry waste at 100% accuracy',
  3: 'Refuse single-use plastic bags',
  4: "Compost the day's food scraps",
  5: 'Audit your desk for e-waste',
  6: 'Rinse and recycle three containers',
  7: 'Invite a campus peer to join EcoSort',
};

/// Points awarded the first time a day is claimed.
const int challengeReward = 15;

/// Demo users seeded in local mode, mirroring the Flask `USER_SEED`. Scores sit
/// between 80 and 145 so the campus battle is populated on first launch.
const List<({String username, String campus, int points})> sampleUsers =
    <({String username, String campus, int points})>[
  (username: 'Aarav', campus: 'North Campus', points: 145),
  (username: 'Meera', campus: 'South Hostel', points: 120),
  (username: 'Kabir', campus: 'Science Block', points: 95),
  (username: 'Diya', campus: 'Main Campus', points: 80),
];
