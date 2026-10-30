import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import 'firebase_options.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  runApp(const FamilyControlApp());
}

class FamilyControlApp extends StatelessWidget {
  const FamilyControlApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Family Control',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF536DFE)),
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFFF5F6FA),
        cardTheme: const CardThemeData(
          elevation: 0,
          margin: EdgeInsets.zero,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.all(Radius.circular(22)),
          ),
        ),
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF8C9EFF),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
        cardTheme: const CardThemeData(
          elevation: 0,
          margin: EdgeInsets.zero,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.all(Radius.circular(22)),
          ),
        ),
      ),
      home: const AuthGate(),
    );
  }
}

class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: FirebaseAuth.instance.authStateChanges(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        if (snapshot.data == null) return const SignInPage();
        return const FamilyDashboard();
      },
    );
  }
}

class SignInPage extends StatefulWidget {
  const SignInPage({super.key});

  @override
  State<SignInPage> createState() => _SignInPageState();
}

class _SignInPageState extends State<SignInPage> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _register = false;
  bool _busy = false;
  bool _obscure = true;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      final auth = FirebaseAuth.instance;
      UserCredential credential;
      if (_register) {
        credential = await auth.createUserWithEmailAndPassword(
          email: _email.text.trim(),
          password: _password.text,
        );
      } else {
        credential = await auth.signInWithEmailAndPassword(
          email: _email.text.trim(),
          password: _password.text,
        );
      }
      await FirebaseFunctions.instance.httpsCallable('ensureFamily').call();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_register ? 'Konto rodzica utworzone.' : 'Zalogowano.')),
      );
    } on FirebaseAuthException catch (error) {
      _showError(error.message ?? error.code);
    } on FirebaseFunctionsException catch (error) {
      _showError(error.message ?? error.code);
    } catch (error) {
      _showError(error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: Theme.of(context).colorScheme.error),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 430),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(26),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Icon(Icons.tv_rounded, size: 54, color: colors.primary),
                        const SizedBox(height: 12),
                        Text(
                          'Family Control',
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                                fontWeight: FontWeight.w800,
                              ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'Zarządzaj czasem telewizora TCL',
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                        const SizedBox(height: 28),
                        TextFormField(
                          controller: _email,
                          keyboardType: TextInputType.emailAddress,
                          autofillHints: const [AutofillHints.email],
                          decoration: const InputDecoration(
                            labelText: 'Adres e-mail',
                            prefixIcon: Icon(Icons.email_outlined),
                            border: OutlineInputBorder(),
                          ),
                          validator: (value) =>
                              value != null && value.contains('@') ? null : 'Podaj poprawny e-mail.',
                        ),
                        const SizedBox(height: 14),
                        TextFormField(
                          controller: _password,
                          obscureText: _obscure,
                          autofillHints: const [AutofillHints.password],
                          decoration: InputDecoration(
                            labelText: 'Hasło',
                            prefixIcon: const Icon(Icons.lock_outline),
                            border: const OutlineInputBorder(),
                            suffixIcon: IconButton(
                              onPressed: () => setState(() => _obscure = !_obscure),
                              icon: Icon(_obscure ? Icons.visibility : Icons.visibility_off),
                            ),
                          ),
                          validator: (value) =>
                              value != null && value.length >= 6 ? null : 'Hasło musi mieć co najmniej 6 znaków.',
                        ),
                        const SizedBox(height: 22),
                        FilledButton(
                          onPressed: _busy ? null : _submit,
                          child: _busy
                              ? const SizedBox(
                                  height: 20,
                                  width: 20,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : Text(_register ? 'Utwórz konto rodzica' : 'Zaloguj się'),
                        ),
                        TextButton(
                          onPressed: _busy ? null : () => setState(() => _register = !_register),
                          child: Text(_register ? 'Mam już konto — zaloguj się' : 'Utwórz nowe konto rodzica'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class FamilyDashboard extends StatefulWidget {
  const FamilyDashboard({super.key});

  @override
  State<FamilyDashboard> createState() => _FamilyDashboardState();
}

class _FamilyDashboardState extends State<FamilyDashboard> {
  late Future<String> _familyFuture;

  @override
  void initState() {
    super.initState();
    _familyFuture = _loadFamily();
  }

  Future<String> _loadFamily() async {
    final result = await FirebaseFunctions.instance.httpsCallable('ensureFamily').call();
    final data = Map<String, dynamic>.from(result.data as Map);
    final familyId = data['familyId'] as String?;
    if (familyId == null || familyId.isEmpty) {
      throw StateError('Firebase nie zwrócił identyfikatora rodziny.');
    }
    return familyId;
  }

  Future<void> _pairTv() async {
    final raw = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const PairScannerPage()),
    );
    if (raw == null || !mounted) return;

    try {
      final uri = Uri.parse(raw);
      final sessionId = uri.queryParameters['session'];
      final code = uri.queryParameters['code'];
      final tvUid = uri.queryParameters['tvUid'];
      if (uri.scheme != 'fc' || uri.host != 'pair' ||
          sessionId == null || code == null || tvUid == null) {
        throw const FormatException('Ten kod QR nie jest kodem Family Control TV.');
      }
      await FirebaseFunctions.instance.httpsCallable('claimPairingSession').call({
        'sessionId': sessionId,
        'code': code,
        'tvUid': tvUid,
        'deviceName': 'Telewizor TCL',
      });
      if (!mounted) return;
      setState(() => _familyFuture = _loadFamily());
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Telewizor został dodany do rodziny.')),
      );
    } on FirebaseFunctionsException catch (error) {
      _error(error.message ?? error.code);
    } catch (error) {
      _error(error.toString());
    }
  }

  Future<void> _sendCommand({
    required String familyId,
    required String deviceId,
    required String type,
    Map<String, dynamic> payload = const {},
  }) async {
    try {
      final uid = FirebaseAuth.instance.currentUser?.uid;
      if (uid == null) throw StateError('Sesja logowania wygasła.');
      final commandId = _commandId();
      await FirebaseFirestore.instance
          .collection('families').doc(familyId)
          .collection('devices').doc(deviceId)
          .collection('commands').doc(commandId)
          .set({
        'commandId': commandId,
        'type': type,
        'payload': payload,
        'createdBy': uid,
        'createdAt': FieldValue.serverTimestamp(),
        'status': 'pending',
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Polecenie wysłane. Czekam na potwierdzenie telewizora.')),
        );
      }
    } on FirebaseException catch (error) {
      _error(error.message ?? error.code);
    } catch (error) {
      _error(error.toString());
    }
  }

  String _commandId() {
    final random = Random.secure();
    return List.generate(32, (_) => random.nextInt(16).toRadixString(16)).join();
  }

  Future<void> _setMinutes(String familyId, String deviceId, {required bool add}) async {
    final controller = TextEditingController(text: add ? '15' : '60');
    final minutes = await showDialog<int>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(add ? 'Dodaj czas' : 'Ustaw limit czasu'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.number,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Liczba minut',
            helperText: 'Od 1 do 1440 minut',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Anuluj'),
          ),
          FilledButton(
            onPressed: () {
              final value = int.tryParse(controller.text.trim());
              if (value == null || value < 1 || value > 1440) return;
              Navigator.pop(dialogContext, value);
            },
            child: const Text('Zapisz'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (minutes == null) return;
    await _sendCommand(
      familyId: familyId,
      deviceId: deviceId,
      type: add ? 'add_time' : 'set_limit',
      payload: {'seconds': minutes * 60},
    );
  }

  void _error(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: Theme.of(context).colorScheme.error),
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = FirebaseAuth.instance.currentUser;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Family Control'),
        actions: [
          IconButton(
            tooltip: 'Wyloguj',
            onPressed: () => FirebaseAuth.instance.signOut(),
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _pairTv,
        icon: const Icon(Icons.qr_code_scanner),
        label: const Text('Dodaj telewizor'),
      ),
      body: FutureBuilder<String>(
        future: _familyFuture,
        builder: (context, familySnapshot) {
          if (familySnapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (familySnapshot.hasError || !familySnapshot.hasData) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.cloud_off, size: 48),
                    const SizedBox(height: 12),
                    Text('Nie udało się połączyć z Firebase: ${familySnapshot.error}'),
                    const SizedBox(height: 12),
                    FilledButton(
                      onPressed: () => setState(() => _familyFuture = _loadFamily()),
                      child: const Text('Spróbuj ponownie'),
                    ),
                  ],
                ),
              ),
            );
          }
          final familyId = familySnapshot.data!;
          return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
            stream: FirebaseFirestore.instance
                .collection('families').doc(familyId)
                .collection('devices')
                .orderBy('createdAt')
                .snapshots(),
            builder: (context, snapshot) {
              if (snapshot.hasError) {
                return Center(child: Text('Błąd Firestore: ${snapshot.error}'));
              }
              if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
              final devices = snapshot.data!.docs;
              if (devices.isEmpty) {
                return _EmptyState(onPair: _pairTv);
              }
              return ListView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 100),
                children: [
                  Text('Twoja rodzina', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
                  const SizedBox(height: 6),
                  Text(user?.email ?? '', style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(height: 18),
                  ...devices.map((device) => Padding(
                    padding: const EdgeInsets.only(bottom: 14),
                    child: _DeviceCard(
                      familyId: familyId,
                      deviceId: device.id,
                      data: device.data(),
                      onCommand: (type, payload) => _sendCommand(
                        familyId: familyId,
                        deviceId: device.id,
                        type: type,
                        payload: payload,
                      ),
                      onAdd: () => _setMinutes(familyId, device.id, add: true),
                      onSet: () => _setMinutes(familyId, device.id, add: false),
                    ),
                  )),
                ],
              );
            },
          );
        },
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onPair});
  final VoidCallback onPair;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.connected_tv, size: 66, color: Theme.of(context).colorScheme.primary),
            const SizedBox(height: 16),
            Text('Nie masz jeszcze podłączonego telewizora', textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            const Text('Uruchom Family Control TV na telewizorze TCL, a następnie zeskanuj wyświetlony kod QR.'),
            const SizedBox(height: 20),
            FilledButton.icon(onPressed: onPair, icon: const Icon(Icons.qr_code_scanner), label: const Text('Sparuj telewizor')),
          ],
        ),
      ),
    );
  }
}

class _DeviceCard extends StatelessWidget {
  const _DeviceCard({
    required this.familyId,
    required this.deviceId,
    required this.data,
    required this.onCommand,
    required this.onAdd,
    required this.onSet,
  });

  final String familyId;
  final String deviceId;
  final Map<String, dynamic> data;
  final Future<void> Function(String, Map<String, dynamic>) onCommand;
  final VoidCallback onAdd;
  final VoidCallback onSet;

  @override
  Widget build(BuildContext context) {
    final locked = data['isLocked'] == true;
    final end = (data['sessionEndServerMillis'] as num?)?.toInt() ?? 0;
    final lastSync = data['lastSyncAt'] as Timestamp?;
    final offset = lastSync == null
        ? 0
        : lastSync.millisecondsSinceEpoch - DateTime.now().millisecondsSinceEpoch;
    final remaining = end > 0
        ? ((end - (DateTime.now().millisecondsSinceEpoch + offset)) / 1000).ceil().clamp(0, 86400).toInt()
        : ((data['remainingSeconds'] as num?)?.toInt() ?? 0);
    final lastSeen = data['lastSeenAt'] as Timestamp?;
    final online = lastSeen != null &&
        DateTime.now().difference(lastSeen.toDate()).inSeconds.abs() < 120;
    final name = data['name'] as String? ?? 'Telewizor TCL';

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(15),
                  ),
                  child: Icon(Icons.tv, color: Theme.of(context).colorScheme.onPrimaryContainer),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                      Text(online ? 'Połączony' : 'Brak połączenia', style: Theme.of(context).textTheme.bodySmall),
                    ],
                  ),
                ),
                Chip(
                  avatar: Icon(locked ? Icons.lock : Icons.lock_open, size: 16),
                  label: Text(locked ? 'Zablokowany' : 'Odblokowany'),
                ),
              ],
            ),
            const SizedBox(height: 20),
            Text(
              end > 0 || remaining > 0 ? _formatTime(remaining) : (locked ? '00:00' : 'Bez limitu'),
              style: Theme.of(context).textTheme.displaySmall?.copyWith(fontWeight: FontWeight.w800),
            ),
            const Text('Pozostały czas'),
            const SizedBox(height: 16),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton.icon(
                  onPressed: () => onCommand(locked ? 'unlock' : 'lock', const {}),
                  icon: Icon(locked ? Icons.lock_open : Icons.lock),
                  label: Text(locked ? 'Odblokuj' : 'Zablokuj'),
                ),
                OutlinedButton.icon(
                  onPressed: onAdd,
                  icon: const Icon(Icons.add_alarm),
                  label: const Text('Dodaj czas'),
                ),
                OutlinedButton.icon(
                  onPressed: onSet,
                  icon: const Icon(Icons.timer),
                  label: const Text('Ustaw limit'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class PairScannerPage extends StatefulWidget {
  const PairScannerPage({super.key});

  @override
  State<PairScannerPage> createState() => _PairScannerPageState();
}

class _PairScannerPageState extends State<PairScannerPage> {
  bool _handled = false;

  void _onDetect(BarcodeCapture capture) {
    if (_handled) return;
    for (final barcode in capture.barcodes) {
      final value = barcode.rawValue;
      if (value != null && value.startsWith('fc://pair?')) {
        _handled = true;
        Navigator.of(context).pop(value);
        return;
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Skanuj kod telewizora')),
      body: Stack(
        children: [
          MobileScanner(onDetect: _onDetect),
          Center(
            child: Container(
              width: 260,
              height: 260,
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white, width: 4),
                borderRadius: BorderRadius.circular(24),
              ),
            ),
          ),
          const Positioned(
            left: 20,
            right: 20,
            bottom: 28,
            child: Card(
              color: Colors.black87,
              child: Padding(
                padding: EdgeInsets.all(14),
                child: Text(
                  'Ustaw kod QR z ekranu telewizora w ramce.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

String _formatTime(int seconds) {
  final safe = seconds.clamp(0, 86400);
  final hours = safe ~/ 3600;
  final minutes = (safe % 3600) ~/ 60;
  final secs = safe % 60;
  if (hours > 0) return '${hours}:${minutes.toString().padLeft(2, '0')}:${secs.toString().padLeft(2, '0')}';
  return '${minutes.toString().padLeft(2, '0')}:${secs.toString().padLeft(2, '0')}';
}
