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
      flagDefaults: {
        "ExampleDescription": true,
        "ResetCounterButton": true,
      },
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
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Feature(
              featureKeys: const ['ExampleDescription'],
              requirement: FeatureRequirement.any,
              child: const AppDescription(),
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
            featureKeys: const ['ResetCounterButton'],
            child: FloatingActionButton(
              onPressed: _resetCounter,
              tooltip: 'Reset',
              backgroundColor: Colors.black54,
              child: const Icon(Icons.refresh),
            ),
          ),
          const SizedBox(width: 8),
          FloatingActionButton(
            onPressed: _incrementCounter,
            tooltip: 'Increment',
            backgroundColor: const Color(0xFF556ee6),
            child: const Icon(Icons.add),
          ),
        ],
      ),
    );
  }
}

class AppDescription extends StatelessWidget {
  const AppDescription({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 100.0, left: 38.0, right: 38.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: const [
          Text(
            'See feature flags in action',
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.bold,
              color: Color(0xFF556ee6),
            ),
          ),
          SizedBox(height: 20.0),
          Text(
            'Provide different values to the "flagDefault" property when initializing Toggly to enable/disable features.',
            style: TextStyle(
              color: Color(0xFF556ee6),
            ),
          ),
        ],
      ),
    );
  }
}
