import 'dart:convert';
import 'dart:io';

import 'package:firebase_auth/firebase_auth.dart';

const String _workerBaseUrl = String.fromEnvironment('FAMILY_CONTROL_API_URL');

class WorkerApi {
  static Future<Map<String, dynamic>> post(
    String path, [
    Map<String, dynamic> payload = const <String, dynamic>{},
  ]) async {
    if (_workerBaseUrl.isEmpty) {
      throw StateError(
        'Brak adresu Cloudflare Worker. Zbuduj aplikację z --dart-define=FAMILY_CONTROL_API_URL=https://...workers.dev',
      );
    }
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw StateError('Sesja logowania Firebase wygasła.');
    final idToken = await user.getIdToken();
    if (idToken == null || idToken.isEmpty) {
      throw StateError('Firebase nie zwrócił tokenu logowania.');
    }

    final client = HttpClient();
    try {
      final uri = Uri.parse(
        _workerBaseUrl.replaceFirst(RegExp(r'/+$'), '') + '/api/' + path.replaceFirst(RegExp(r'^/+'), ''),
      );
      final request = await client.postUrl(uri);
      request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $idToken');
      request.headers.contentType = ContentType.json;
      request.write(jsonEncode(payload));

      final response = await request.close();
      final responseBody = await utf8.decoder.bind(response).join();
      Map<String, dynamic> data = <String, dynamic>{};
      if (responseBody.isNotEmpty) {
        final decoded = jsonDecode(responseBody);
        if (decoded is Map<String, dynamic>) data = decoded;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw StateError(data['error']?.toString() ?? 'Błąd backendu HTTP \${response.statusCode}.');
      }
      return data;
    } finally {
      client.close(force: true);
    }
  }
}
