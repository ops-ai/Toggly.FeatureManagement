import 'package:flutter/material.dart';
import 'package:toggly/toggly.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Flutter Demo',
      theme: ThemeData(
        primarySwatch: Colors.blueGrey,
      ),
      home: const MyHomePage(title: 'Toggly Flutter Example'),
    );
  }
}

class MyHomePage extends StatefulWidget {
  const MyHomePage({super.key, required this.title});

  final String title;

  @override
  State<MyHomePage> createState() => _MyHomePageState();
}

class _MyHomePageState extends State<MyHomePage> {
  int _counter = 0;

  void _incrementCounter() {
    setState(() {
      _counter++;
    });
  }

  void _resetCounter() {
    setState(() {
      _counter = 0;
    });
  }

  @override
  void initState() {
    initToggly();
    super.initState();
  }

  void initToggly() async {
    await Toggly.init(
      apiKey: '9ff6fcc9-fd83-4dd9-8495-9f6fa980c386',
      environment: 'Production',
      identity: 'random-user-identifier',
      config: const TogglyConfig(
        featureFlagsRefreshInterval: 10 * 1000,
        isDebug: true,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            const Feature(
              featureKeys: ['Test1', 'Test2'],
              requirement: FeatureRequirement.any,
              child: Padding(
                padding: EdgeInsets.only(bottom: 60.0),
                child: Text(
                  'Take Control of Your App',
                  style: TextStyle(
                    color: Color(0xFF556ee6),
                    fontSize: 25,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ),
            const Text(
              'You have pushed the button this many times:',
            ),
            Text(
              '$_counter',
              style: Theme.of(context).textTheme.headline4,
            ),
          ],
        ),
      ),
      floatingActionButton: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          Feature(
            featureKeys: const ['Test1'],
            child: FloatingActionButton(
              onPressed: _resetCounter,
              tooltip: 'Reset',
              backgroundColor: Colors.black54,
              child: const Icon(Icons.refresh),
            ),
          ),
          const SizedBox(width: 8),
          Feature(
            featureKeys: const ['Test2'],
            child: FloatingActionButton(
              onPressed: _incrementCounter,
              tooltip: 'Increment',
              backgroundColor: const Color(0xFF556ee6),
              child: const Icon(Icons.add),
            ),
          ),
        ],
      ),
    );
  }
}
