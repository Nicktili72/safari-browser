// Hermes Safari Bridge - minimal wrapper app
// Just needs to be a proper app that registers the extension with Safari.
#include <Cocoa/Cocoa.h>

int main(int argc, char *argv[]) {
    NSApplicationLoad();
    // Register the extension bundle path with Safari
    NSString *extensionPath = [[NSBundle mainBundle] pathForResource:@"Hermes Safari Bridge Extension" ofType:@"appex"];
    if (extensionPath) {
        NSLog(@"Safari Bridge: extension loaded at %@", extensionPath);
    }
    [[NSNotificationCenter defaultCenter] addObserver:nil selector:@selector(appDidFinishLaunching:) name:NSApplicationDidFinishLaunchingNotification object:nil];
    return NSApplicationMain(argc, argv);
}

static void appDidFinishLaunching(NSNotification *n) {
    // Don't actually launch the app UI — just let Safari pick up the extension.
    // Safari will handle the extension lifecycle.
    NSLog(@"Hermes Safari Bridge app launched.");
}
